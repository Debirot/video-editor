//! Protocolo `media://`: única ponte de bytes de mídia entre o disco e o Worker.
//!
//! Rotas:
//! - `GET|HEAD /file/<caminho codificado>` lê um arquivo autorizado, com suporte a Range.
//! - `PUT /write/<id>?pos=<n>` grava um pedaço do MP4 exportado na posição n.
//! - `OPTIONS *` responde ao preflight de CORS (no Windows o WebView2 trata
//!   `http://media.localhost` como outra origem).
//!
//! Respostas de leitura são limitadas a `MAX_CHUNK` bytes: o protocolo customizado
//! do Tauri devolve o corpo inteiro na memória, então nunca lemos o arquivo todo.
//! O Mediabunny continua a leitura com um novo Range quando a resposta vem curta.

use std::collections::{HashMap, HashSet};
use std::ffi::OsString;
use std::fs::{self, File, OpenOptions};
use std::io::{self, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, RwLock};

use percent_encoding::percent_decode_str;
use tauri::http::{header, Method, Request, Response, StatusCode};

/// Maior corpo de resposta para um pedido com Range.
pub const MAX_CHUNK: u64 = 2 * 1024 * 1024;
/// Arquivos até este tamanho são servidos inteiros quando o pedido não tem Range.
pub const MAX_FULL: u64 = 8 * 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RangeSpec {
    /// Corpo inteiro, status 200.
    Full,
    /// Bytes `start..=end`, status 206.
    Partial { start: u64, end: u64 },
    /// Status 416.
    Unsatisfiable,
}

/// Interpreta o cabeçalho Range para um arquivo de `size` bytes, limitando o
/// tamanho da resposta a `max_chunk`. Cabeçalho malformado é ignorado (RFC 9110).
pub fn resolve_range(header: Option<&str>, size: u64, max_chunk: u64) -> RangeSpec {
    let without_range = || {
        if size <= MAX_FULL {
            RangeSpec::Full
        } else {
            RangeSpec::Partial {
                start: 0,
                end: max_chunk.min(size) - 1,
            }
        }
    };
    let Some(spec) = header.and_then(|h| h.trim().strip_prefix("bytes=")) else {
        return without_range();
    };
    // Só a primeira faixa de um pedido com várias.
    let first = spec.split(',').next().unwrap_or("").trim();
    let Some((a, b)) = first.split_once('-') else {
        return without_range();
    };
    let (a, b) = (a.trim(), b.trim());

    let (start, end) = if a.is_empty() {
        // Sufixo: últimos n bytes.
        let Ok(n) = b.parse::<u64>() else {
            return without_range();
        };
        if n == 0 || size == 0 {
            return RangeSpec::Unsatisfiable;
        }
        (size.saturating_sub(n), size - 1)
    } else {
        let Ok(start) = a.parse::<u64>() else {
            return without_range();
        };
        let end = if b.is_empty() {
            u64::MAX
        } else {
            match b.parse::<u64>() {
                Ok(e) if e >= start => e,
                _ => return without_range(),
            }
        };
        if start >= size {
            return RangeSpec::Unsatisfiable;
        }
        (start, end.min(size - 1))
    };
    RangeSpec::Partial {
        start,
        end: end.min(start + max_chunk - 1),
    }
}

#[derive(Debug, PartialEq, Eq)]
pub enum Route {
    File(PathBuf),
    Write(u64),
}

/// Lê a rota a partir do caminho da URI (ainda codificado).
pub fn parse_route(uri_path: &str) -> Option<Route> {
    let path = uri_path.trim_start_matches('/');
    let (kind, rest) = path.split_once('/')?;
    match kind {
        "file" => {
            let decoded = percent_decode_str(rest).decode_utf8().ok()?;
            if decoded.is_empty() {
                return None;
            }
            Some(Route::File(PathBuf::from(decoded.as_ref())))
        }
        "write" => rest.parse().ok().map(Route::Write),
        _ => None,
    }
}

fn query_pos(query: Option<&str>) -> Option<u64> {
    query?
        .split('&')
        .find_map(|kv| kv.strip_prefix("pos="))
        .and_then(|v| v.parse().ok())
}

fn content_type(path: &Path) -> &'static str {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    match ext.as_str() {
        "mp4" | "m4v" => "video/mp4",
        "mov" => "video/quicktime",
        "webm" => "video/webm",
        "mkv" => "video/x-matroska",
        "mp3" => "audio/mpeg",
        "m4a" | "aac" => "audio/mp4",
        "wav" => "audio/wav",
        "ogg" | "opus" => "audio/ogg",
        "flac" => "audio/flac",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        _ => "application/octet-stream",
    }
}

struct ExportSession {
    final_path: PathBuf,
    partial_path: PathBuf,
    file: File,
}

/// Estado compartilhado do protocolo: arquivos autorizados e exportações abertas.
#[derive(Default)]
pub struct MediaState {
    allowed: RwLock<HashSet<PathBuf>>,
    exports: Mutex<HashMap<u64, ExportSession>>,
    next_export_id: AtomicU64,
}

fn partial_path_for(path: &Path) -> PathBuf {
    let mut s: OsString = path.as_os_str().to_owned();
    s.push(".partial");
    PathBuf::from(s)
}

fn unknown_export(id: u64) -> io::Error {
    io::Error::new(
        io::ErrorKind::NotFound,
        format!("exportação {id} não existe"),
    )
}

impl MediaState {
    /// Autoriza a leitura de um arquivo escolhido pelo usuário.
    pub fn allow(&self, path: &Path) -> io::Result<()> {
        let canonical = fs::canonicalize(path)?;
        if !canonical.is_file() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "não é um arquivo",
            ));
        }
        self.allowed.write().unwrap().insert(canonical);
        Ok(())
    }

    pub fn is_allowed(&self, path: &Path) -> bool {
        match fs::canonicalize(path) {
            Ok(c) => self.allowed.read().unwrap().contains(&c),
            Err(_) => false,
        }
    }

    /// Cria `<path>.partial` e devolve o id da sessão de escrita.
    pub fn begin_export(&self, path: &Path) -> io::Result<u64> {
        let partial_path = partial_path_for(path);
        let file = OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .open(&partial_path)?;
        let id = self.next_export_id.fetch_add(1, Ordering::Relaxed) + 1;
        self.exports.lock().unwrap().insert(
            id,
            ExportSession {
                final_path: path.to_path_buf(),
                partial_path,
                file,
            },
        );
        Ok(id)
    }

    pub fn write_export(&self, id: u64, pos: u64, data: &[u8]) -> io::Result<()> {
        let mut exports = self.exports.lock().unwrap();
        let session = exports.get_mut(&id).ok_or_else(|| unknown_export(id))?;
        session.file.seek(SeekFrom::Start(pos))?;
        session.file.write_all(data)
    }

    /// Grava em disco, renomeia para o caminho final (substituindo) e devolve o tamanho.
    pub fn finish_export(&self, id: u64) -> io::Result<u64> {
        let session = self
            .exports
            .lock()
            .unwrap()
            .remove(&id)
            .ok_or_else(|| unknown_export(id))?;
        session.file.sync_all()?;
        drop(session.file);
        fs::rename(&session.partial_path, &session.final_path)?;
        Ok(fs::metadata(&session.final_path)?.len())
    }

    /// Fecha e apaga o arquivo parcial. Cancelar uma sessão inexistente não é erro.
    pub fn cancel_export(&self, id: u64) -> io::Result<()> {
        let Some(session) = self.exports.lock().unwrap().remove(&id) else {
            return Ok(());
        };
        drop(session.file);
        match fs::remove_file(&session.partial_path) {
            Err(e) if e.kind() != io::ErrorKind::NotFound => Err(e),
            _ => Ok(()),
        }
    }
}

struct HttpError(StatusCode, String);

impl From<io::Error> for HttpError {
    fn from(e: io::Error) -> Self {
        let status = match e.kind() {
            io::ErrorKind::NotFound => StatusCode::NOT_FOUND,
            io::ErrorKind::PermissionDenied => StatusCode::FORBIDDEN,
            _ => StatusCode::INTERNAL_SERVER_ERROR,
        };
        HttpError(status, e.to_string())
    }
}

fn with_cors(builder: tauri::http::response::Builder) -> tauri::http::response::Builder {
    builder
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .header(
            header::ACCESS_CONTROL_ALLOW_METHODS,
            "GET, HEAD, PUT, OPTIONS",
        )
        .header(header::ACCESS_CONTROL_ALLOW_HEADERS, "Range, Content-Type")
        .header(
            header::ACCESS_CONTROL_EXPOSE_HEADERS,
            "Content-Range, Content-Length, Accept-Ranges",
        )
}

fn respond(status: StatusCode, body: Vec<u8>) -> Response<Vec<u8>> {
    with_cors(Response::builder().status(status))
        .body(body)
        .unwrap()
}

/// Atende um pedido do protocolo. Roda fora da thread principal (spawn_blocking).
pub fn handle(state: &MediaState, req: Request<Vec<u8>>) -> Response<Vec<u8>> {
    match handle_inner(state, &req) {
        Ok(res) => res,
        Err(HttpError(status, msg)) => {
            let mut res = respond(status, msg.into_bytes());
            res.headers_mut().insert(
                header::CONTENT_TYPE,
                "text/plain; charset=utf-8".parse().unwrap(),
            );
            res
        }
    }
}

fn handle_inner(
    state: &MediaState,
    req: &Request<Vec<u8>>,
) -> Result<Response<Vec<u8>>, HttpError> {
    if req.method() == Method::OPTIONS {
        return Ok(respond(StatusCode::NO_CONTENT, Vec::new()));
    }
    let route = parse_route(req.uri().path())
        .ok_or_else(|| HttpError(StatusCode::NOT_FOUND, "rota desconhecida".into()))?;

    match (req.method(), route) {
        (&Method::GET | &Method::HEAD, Route::File(path)) => {
            if !state.is_allowed(&path) {
                return Err(HttpError(
                    StatusCode::FORBIDDEN,
                    format!("arquivo não autorizado: {}", path.display()),
                ));
            }
            serve_file(
                &path,
                req.headers()
                    .get(header::RANGE)
                    .and_then(|v| v.to_str().ok()),
                req.method() == Method::HEAD,
            )
        }
        (&Method::PUT | &Method::POST, Route::Write(id)) => {
            let pos = query_pos(req.uri().query())
                .ok_or_else(|| HttpError(StatusCode::BAD_REQUEST, "falta ?pos=".into()))?;
            state.write_export(id, pos, req.body())?;
            Ok(respond(StatusCode::NO_CONTENT, Vec::new()))
        }
        _ => Err(HttpError(
            StatusCode::METHOD_NOT_ALLOWED,
            "método não permitido".into(),
        )),
    }
}

fn serve_file(
    path: &Path,
    range: Option<&str>,
    head_only: bool,
) -> Result<Response<Vec<u8>>, HttpError> {
    let mut file = File::open(path)?;
    let size = file.metadata()?.len();
    let base = with_cors(Response::builder())
        .header(header::ACCEPT_RANGES, "bytes")
        .header(header::CONTENT_TYPE, content_type(path));

    let (builder, start, len) = match resolve_range(range, size, MAX_CHUNK) {
        RangeSpec::Unsatisfiable => {
            let res = base
                .status(StatusCode::RANGE_NOT_SATISFIABLE)
                .header(header::CONTENT_RANGE, format!("bytes */{size}"))
                .body(Vec::new())
                .unwrap();
            return Ok(res);
        }
        RangeSpec::Full => (base.status(StatusCode::OK), 0, size),
        RangeSpec::Partial { start, end } => (
            base.status(StatusCode::PARTIAL_CONTENT)
                .header(header::CONTENT_RANGE, format!("bytes {start}-{end}/{size}")),
            start,
            end - start + 1,
        ),
    };
    let builder = builder.header(header::CONTENT_LENGTH, len);
    if head_only {
        return Ok(builder.body(Vec::new()).unwrap());
    }
    let mut body = vec![0u8; len as usize];
    file.seek(SeekFrom::Start(start))?;
    file.read_exact(&mut body)?;
    Ok(builder.body(body).unwrap())
}

#[cfg(test)]
mod tests {
    use super::*;
    use percent_encoding::{utf8_percent_encode, NON_ALPHANUMERIC};

    const MB: u64 = 1024 * 1024;

    #[test]
    fn range_table() {
        use RangeSpec::*;
        let max = 100;
        let cases: &[(Option<&str>, u64, RangeSpec)] = &[
            (None, 50, Full),
            (
                None,
                20 * MB,
                Partial {
                    start: 0,
                    end: max - 1,
                },
            ),
            (Some("bytes=0-9"), 50, Partial { start: 0, end: 9 }),
            (Some("bytes=10-"), 50, Partial { start: 10, end: 49 }),
            (
                Some("bytes=10-"),
                1000,
                Partial {
                    start: 10,
                    end: 109,
                },
            ),
            (Some("bytes=0-999"), 50, Partial { start: 0, end: 49 }),
            (Some("bytes=-5"), 50, Partial { start: 45, end: 49 }),
            (Some("bytes=-500"), 50, Partial { start: 0, end: 49 }),
            (Some("bytes=50-"), 50, Unsatisfiable),
            (Some("bytes=0-"), 0, Unsatisfiable),
            (Some("bytes=-0"), 50, Unsatisfiable),
            (Some("bytes=5-1"), 50, Full),
            (Some("bytes=abc"), 50, Full),
            (Some("items=0-1"), 50, Full),
            (Some("bytes=0-1, 5-6"), 50, Partial { start: 0, end: 1 }),
            (Some(" bytes= 3 - 4 "), 50, Partial { start: 3, end: 4 }),
        ];
        for (header, size, expected) in cases {
            assert_eq!(
                resolve_range(*header, *size, max),
                *expected,
                "{header:?} size={size}"
            );
        }
    }

    #[test]
    fn routes() {
        let encoded = utf8_percent_encode("D:/Vídeos/trem 1.mp4", NON_ALPHANUMERIC).to_string();
        assert_eq!(
            parse_route(&format!("/file/{encoded}")),
            Some(Route::File(PathBuf::from("D:/Vídeos/trem 1.mp4")))
        );
        assert_eq!(parse_route("/write/42"), Some(Route::Write(42)));
        assert_eq!(parse_route("/write/abc"), None);
        assert_eq!(parse_route("/file/"), None);
        assert_eq!(parse_route("/outra/x"), None);
        assert_eq!(parse_route("/"), None);
        assert_eq!(query_pos(Some("pos=1024")), Some(1024));
        assert_eq!(query_pos(Some("a=1&pos=7")), Some(7));
        assert_eq!(query_pos(None), None);
    }

    fn file_url(path: &Path) -> String {
        let encoded = utf8_percent_encode(path.to_str().unwrap(), NON_ALPHANUMERIC);
        format!("media://localhost/file/{encoded}")
    }

    fn get(state: &MediaState, url: &str, range: Option<&str>) -> Response<Vec<u8>> {
        let mut b = Request::builder().method("GET").uri(url);
        if let Some(r) = range {
            b = b.header("Range", r);
        }
        handle(state, b.body(Vec::new()).unwrap())
    }

    #[test]
    fn serves_allowed_file_with_range() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("clipe de teste.mp4");
        let data: Vec<u8> = (0..=255u8).cycle().take(5000).collect();
        fs::write(&path, &data).unwrap();
        let state = MediaState::default();

        let res = get(&state, &file_url(&path), Some("bytes=100-199"));
        assert_eq!(
            res.status(),
            StatusCode::FORBIDDEN,
            "sem autorização não serve"
        );

        state.allow(&path).unwrap();
        let res = get(&state, &file_url(&path), Some("bytes=100-199"));
        assert_eq!(res.status(), StatusCode::PARTIAL_CONTENT);
        assert_eq!(res.headers()[header::CONTENT_RANGE], "bytes 100-199/5000");
        assert_eq!(res.headers()[header::CONTENT_TYPE], "video/mp4");
        assert_eq!(res.headers()[header::ACCESS_CONTROL_ALLOW_ORIGIN], "*");
        assert_eq!(res.body().as_slice(), &data[100..200]);

        let res = get(&state, &file_url(&path), None);
        assert_eq!(res.status(), StatusCode::OK);
        assert_eq!(res.body().len(), 5000);

        let res = get(&state, &file_url(&path), Some("bytes=9000-"));
        assert_eq!(res.status(), StatusCode::RANGE_NOT_SATISFIABLE);
        assert_eq!(res.headers()[header::CONTENT_RANGE], "bytes */5000");
    }

    #[test]
    fn large_file_is_chunked() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("grande.mp4");
        let f = File::create(&path).unwrap();
        f.set_len(3 * MAX_CHUNK + 7).unwrap();
        drop(f);
        let state = MediaState::default();
        state.allow(&path).unwrap();
        let res = get(&state, &file_url(&path), Some("bytes=0-"));
        assert_eq!(res.status(), StatusCode::PARTIAL_CONTENT);
        assert_eq!(res.body().len() as u64, MAX_CHUNK);
        let size = 3 * MAX_CHUNK + 7;
        assert_eq!(
            res.headers()[header::CONTENT_RANGE],
            format!("bytes 0-{}/{size}", MAX_CHUNK - 1).as_str()
        );
    }

    #[test]
    fn allow_rejects_dirs_and_missing() {
        let dir = tempfile::tempdir().unwrap();
        let state = MediaState::default();
        assert!(state.allow(dir.path()).is_err());
        assert!(state.allow(&dir.path().join("nao-existe.mp4")).is_err());
        assert!(!state.is_allowed(&dir.path().join("nao-existe.mp4")));
    }

    #[test]
    fn export_write_finish() {
        let dir = tempfile::tempdir().unwrap();
        let out = dir.path().join("saida.mp4");
        fs::write(&out, b"arquivo antigo").unwrap();
        let state = MediaState::default();
        let id = state.begin_export(&out).unwrap();

        // Fora de ordem, como o muxer faz ao reescrever o cabeçalho.
        let put = |pos: u64, body: &[u8]| {
            let req = Request::builder()
                .method("PUT")
                .uri(format!("media://localhost/write/{id}?pos={pos}"))
                .body(body.to_vec())
                .unwrap();
            handle(&state, req).status()
        };
        assert_eq!(put(4, b"5678"), StatusCode::NO_CONTENT);
        assert_eq!(put(0, b"abcd"), StatusCode::NO_CONTENT);
        assert_eq!(put(0, b"ABCD"), StatusCode::NO_CONTENT);

        // O destino só muda ao concluir.
        assert_eq!(fs::read(&out).unwrap(), b"arquivo antigo");
        assert_eq!(state.finish_export(id).unwrap(), 8);
        assert_eq!(fs::read(&out).unwrap(), b"ABCD5678");
        assert!(!partial_path_for(&out).exists());
        assert!(state.write_export(id, 0, b"x").is_err(), "sessão fechada");
    }

    #[test]
    fn export_cancel_removes_partial() {
        let dir = tempfile::tempdir().unwrap();
        let out = dir.path().join("cancelado.mp4");
        let state = MediaState::default();
        let id = state.begin_export(&out).unwrap();
        state.write_export(id, 0, &[1, 2, 3]).unwrap();
        assert!(partial_path_for(&out).exists());
        state.cancel_export(id).unwrap();
        assert!(!partial_path_for(&out).exists());
        assert!(!out.exists());
        state.cancel_export(id).unwrap(); // idempotente
    }

    #[test]
    fn write_errors() {
        let state = MediaState::default();
        let req = Request::builder()
            .method("PUT")
            .uri("media://localhost/write/99?pos=0")
            .body(vec![1])
            .unwrap();
        assert_eq!(handle(&state, req).status(), StatusCode::NOT_FOUND);
        let req = Request::builder()
            .method("PUT")
            .uri("media://localhost/write/1")
            .body(vec![1])
            .unwrap();
        assert_eq!(handle(&state, req).status(), StatusCode::BAD_REQUEST);
        let req = Request::builder()
            .method("OPTIONS")
            .uri("media://localhost/write/1")
            .body(vec![])
            .unwrap();
        let res = handle(&state, req);
        assert_eq!(res.status(), StatusCode::NO_CONTENT);
        assert_eq!(
            res.headers()[header::ACCESS_CONTROL_ALLOW_METHODS],
            "GET, HEAD, PUT, OPTIONS"
        );
        let req = Request::builder()
            .method("DELETE")
            .uri("media://localhost/write/1")
            .body(vec![])
            .unwrap();
        assert_eq!(handle(&state, req).status(), StatusCode::METHOD_NOT_ALLOWED);
    }
}
