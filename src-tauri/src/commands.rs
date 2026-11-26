//! Todos os comandos que a interface pode chamar (`invoke`).
//! Funções curtas: validam a entrada e delegam aos módulos.
//! Os wrappers tipados do lado TypeScript ficam em src/lib/ipc.ts.

use std::path::PathBuf;
use std::sync::Arc;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::cache::Cache;
use crate::ffmpeg::{self, MediaKind};
use crate::jobs::{JobQueue, Priority};
use crate::media::{self, ImportOutcome, ImportedMedia};
use crate::protocol::MediaState;

fn describe(path: &std::path::Path, e: std::io::Error) -> String {
    format!("{}: {e}", path.display())
}

/// Autoriza o protocolo media:// a ler um arquivo escolhido pelo usuário.
#[tauri::command]
pub fn allow_media(state: State<'_, MediaState>, path: PathBuf) -> Result<(), String> {
    state.allow(&path).map_err(|e| describe(&path, e))
}

/// Abre uma sessão de escrita. O Worker grava pela rota media://.../write/<id>.
#[tauri::command]
pub fn begin_export(state: State<'_, MediaState>, path: PathBuf) -> Result<u64, String> {
    if path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case("mp4"))
        != Some(true)
    {
        return Err("a exportação precisa terminar em .mp4".into());
    }
    state.begin_export(&path).map_err(|e| describe(&path, e))
}

/// Conclui a exportação e devolve o tamanho final em bytes.
#[tauri::command]
pub fn finish_export(state: State<'_, MediaState>, id: u64) -> Result<u64, String> {
    state.finish_export(id).map_err(|e| e.to_string())
}

/// Cancela a exportação e apaga o arquivo parcial.
#[tauri::command]
pub fn cancel_export(state: State<'_, MediaState>, id: u64) -> Result<(), String> {
    state.cancel_export(id).map_err(|e| e.to_string())
}

/// Largura do pôster na biblioteca (2× a célula da grade, para telas de alta densidade).
const POSTER_WIDTH: u32 = 320;

/// Evento `job:done`, enviado quando uma tarefa em segundo plano termina.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JobDone {
    pub key: String,
    pub kind: &'static str,
    pub media_hash: String,
    pub ok: bool,
    pub error: Option<String>,
    /// Caminho relativo no cache do arquivo gerado (pôster etc.).
    pub output: Option<String>,
}

/// Importa arquivos: fingerprint e ffprobe (até 4 ao mesmo tempo), autoriza a leitura
/// pelo media:// e coloca os pôsteres que faltam na fila. Um arquivo com erro não
/// impede os outros; cada um volta com status "ok" ou "failed".
#[tauri::command]
pub async fn import_media(
    app: AppHandle,
    paths: Vec<PathBuf>,
) -> Result<Vec<ImportOutcome>, String> {
    let mut set = tokio::task::JoinSet::new();
    for (index, path) in paths.into_iter().enumerate() {
        let app = app.clone();
        set.spawn(async move { (index, import_one(&app, path).await) });
    }
    let mut results = Vec::new();
    while let Some(joined) = set.join_next().await {
        results.push(joined.map_err(|e| e.to_string())?);
    }
    // Mantém a ordem em que os arquivos foram escolhidos.
    results.sort_by_key(|(i, _)| *i);
    Ok(results.into_iter().map(|(_, r)| r).collect())
}

async fn import_one(app: &AppHandle, path: PathBuf) -> ImportOutcome {
    match try_import(app, &path).await {
        Ok(media) => ImportOutcome::Ok { media },
        Err(error) => ImportOutcome::Failed { path, error },
    }
}

async fn try_import(app: &AppHandle, path: &std::path::Path) -> Result<ImportedMedia, String> {
    let queue = app.state::<Arc<JobQueue>>().inner().clone();
    let (fingerprint, (kind, probe)) = {
        let _slot = queue.acquire(Priority::High).await;
        let p = path.to_path_buf();
        let fingerprint = tokio::task::spawn_blocking(move || media::fingerprint(&p))
            .await
            .map_err(|e| e.to_string())?
            .map_err(|e| describe(path, e))?;
        (fingerprint, ffmpeg::probe(path).await?)
    };
    app.state::<MediaState>()
        .allow(path)
        .map_err(|e| describe(path, e))?;

    let cache = app.state::<Cache>().inner().clone();
    let hash = fingerprint.partial_hash.clone();
    let poster_file = cache.poster(&hash);
    let mut poster = None;
    let mut poster_pending = false;
    if kind != MediaKind::Audio {
        if poster_file.is_file() {
            poster = Some(Cache::poster_rel(&hash));
        } else {
            let key = format!("poster:{hash}");
            poster_pending = true;
            if !queue.is_active(&key) {
                let input = path.to_path_buf();
                let at = media::poster_time(kind, probe.duration);
                let app = app.clone();
                let done_hash = hash.clone();
                queue.spawn(
                    key.clone(),
                    Priority::High,
                    async move { ffmpeg::poster(&input, &poster_file, at, POSTER_WIDTH).await },
                    move |result| {
                        let event = JobDone {
                            key,
                            kind: "poster",
                            output: result.is_ok().then(|| Cache::poster_rel(&done_hash)),
                            media_hash: done_hash,
                            ok: result.is_ok(),
                            error: result.err(),
                        };
                        let _ = app.emit("job:done", event);
                    },
                );
            }
        }
    }

    Ok(ImportedMedia {
        path: path.to_path_buf(),
        kind,
        fingerprint,
        probe,
        poster,
        poster_pending,
    })
}
