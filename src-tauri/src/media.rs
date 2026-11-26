//! Mídias: fingerprint (para religar e para nomear o cache) e importação.

use std::fs::File;
use std::io::{self, Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde::Serialize;

use crate::ffmpeg::{MediaKind, MediaProbe};

/// Bytes lidos do início e do fim do arquivo para o hash parcial.
const HASH_SPAN: u64 = 64 * 1024;

/// Espelha `Media.fingerprint` de src/project/types.ts.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Fingerprint {
    pub size: u64,
    /// Segundos desde 1970.
    pub mtime: i64,
    /// 16 caracteres hex: FNV-1a 64 do tamanho, dos primeiros e dos últimos 64 KB.
    pub partial_hash: String,
}

/// FNV-1a 64 bits. Não é criptográfico: serve para nomear cache e reconhecer arquivos.
fn fnv1a64(mut hash: u64, bytes: &[u8]) -> u64 {
    for b in bytes {
        hash ^= u64::from(*b);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    hash
}

const FNV_OFFSET: u64 = 0xcbf2_9ce4_8422_2325;

pub fn fingerprint(path: &Path) -> io::Result<Fingerprint> {
    let mut file = File::open(path)?;
    let meta = file.metadata()?;
    let size = meta.len();
    let mtime = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map_or(0, |d| d.as_secs() as i64);

    let mut hash = fnv1a64(FNV_OFFSET, &size.to_le_bytes());
    let mut buf = vec![0u8; HASH_SPAN.min(size) as usize];
    file.read_exact(&mut buf)?;
    hash = fnv1a64(hash, &buf);
    if size > HASH_SPAN {
        let tail_start = size.saturating_sub(HASH_SPAN).max(HASH_SPAN);
        let mut tail = vec![0u8; (size - tail_start) as usize];
        file.seek(SeekFrom::Start(tail_start))?;
        file.read_exact(&mut tail)?;
        hash = fnv1a64(hash, &tail);
    }
    Ok(Fingerprint {
        size,
        mtime,
        partial_hash: format!("{hash:016x}"),
    })
}

/// Instante do pôster: 10% da duração (0 para imagens e mídias curtas).
pub fn poster_time(kind: MediaKind, duration_us: i64) -> i64 {
    match kind {
        MediaKind::Video => duration_us / 10,
        _ => 0,
    }
}

/// Resultado da importação de um arquivo, enviado à interface.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedMedia {
    pub path: PathBuf,
    pub kind: MediaKind,
    pub fingerprint: Fingerprint,
    pub probe: MediaProbe,
    /// Caminho relativo no cache, quando o pôster já existe.
    pub poster: Option<String>,
    /// O pôster foi colocado na fila; chega pelo evento job:done.
    pub poster_pending: bool,
}

#[derive(Debug, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum ImportOutcome {
    Ok { media: ImportedMedia },
    Failed { path: PathBuf, error: String },
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fingerprint_detects_changes_and_is_stable() {
        let dir = tempfile::tempdir().unwrap();
        let a = dir.path().join("a.bin");
        let data: Vec<u8> = (0..300_000u32).map(|i| (i % 251) as u8).collect();
        std::fs::write(&a, &data).unwrap();

        let f1 = fingerprint(&a).unwrap();
        assert_eq!(f1.size, 300_000);
        assert_eq!(f1.partial_hash.len(), 16);
        assert_eq!(fingerprint(&a).unwrap(), f1, "estável");

        // Mesma cópia em outro caminho → mesmo hash (proxy compartilhado entre projetos).
        let b = dir.path().join("copia.bin");
        std::fs::write(&b, &data).unwrap();
        assert_eq!(fingerprint(&b).unwrap().partial_hash, f1.partial_hash);

        // Mudar o último byte muda o hash.
        let mut changed = data.clone();
        *changed.last_mut().unwrap() ^= 1;
        std::fs::write(&b, &changed).unwrap();
        assert_ne!(fingerprint(&b).unwrap().partial_hash, f1.partial_hash);

        // Mudar só o meio não muda (hash parcial, por desenho).
        let mut middle = data.clone();
        middle[150_000] ^= 1;
        std::fs::write(&b, &middle).unwrap();
        assert_eq!(fingerprint(&b).unwrap().partial_hash, f1.partial_hash);
    }

    #[test]
    fn small_and_empty_files() {
        let dir = tempfile::tempdir().unwrap();
        let small = dir.path().join("s.bin");
        std::fs::write(&small, b"abc").unwrap();
        let empty = dir.path().join("e.bin");
        std::fs::write(&empty, b"").unwrap();
        let fs = fingerprint(&small).unwrap();
        let fe = fingerprint(&empty).unwrap();
        assert_eq!(fs.size, 3);
        assert_eq!(fe.size, 0);
        assert_ne!(fs.partial_hash, fe.partial_hash);
        assert!(fingerprint(&dir.path().join("x")).is_err());
    }

    #[test]
    fn poster_instant() {
        assert_eq!(poster_time(MediaKind::Video, 95_000_000), 9_500_000);
        assert_eq!(poster_time(MediaKind::Image, 0), 0);
    }
}
