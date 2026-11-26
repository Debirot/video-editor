//! Pasta de cache do app (miniaturas, picos, proxies), organizada pelo hash de cada mídia.
//! Tudo aqui é descartável: apagar a pasta só obriga o app a gerar os arquivos de novo.
//! O limite de tamanho e a limpeza dos mais antigos entram com os proxies (Fase 3).

use std::path::{Component, Path, PathBuf};

#[derive(Debug, Clone)]
pub struct Cache {
    root: PathBuf,
}

impl Cache {
    pub fn new(root: PathBuf) -> Self {
        Cache { root }
    }

    /// Caminho relativo (com "/") do pôster de uma mídia, usado na URL media://.../cache/...
    pub fn poster_rel(hash: &str) -> String {
        format!("media/{hash}/poster.jpg")
    }

    pub fn poster(&self, hash: &str) -> PathBuf {
        self.resolve(&Self::poster_rel(hash))
            .expect("hash é seguro")
    }

    /// Junta um caminho relativo à raiz do cache, recusando "..", raiz ou prefixo de disco.
    pub fn resolve(&self, rel: &str) -> Option<PathBuf> {
        safe_join(&self.root, rel)
    }
}

pub fn safe_join(root: &Path, rel: &str) -> Option<PathBuf> {
    if rel.is_empty() || rel.contains('\\') || rel.contains(':') {
        return None;
    }
    let rel_path = Path::new(rel);
    if !rel_path
        .components()
        .all(|c| matches!(c, Component::Normal(_)))
    {
        return None;
    }
    Some(root.join(rel_path))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn safe_paths() {
        let root = Path::new("/cache");
        assert_eq!(
            safe_join(root, "media/abc/poster.jpg"),
            Some(PathBuf::from("/cache/media/abc/poster.jpg"))
        );
        for bad in [
            "",
            "../x",
            "media/../../x",
            "/etc/passwd",
            "C:/x",
            "a\\..\\b",
            "./x",
        ] {
            assert_eq!(safe_join(root, bad), None, "{bad}");
        }
    }

    #[test]
    fn poster_path() {
        let c = Cache::new(PathBuf::from("/c"));
        assert_eq!(c.poster("ab12"), PathBuf::from("/c/media/ab12/poster.jpg"));
        assert_eq!(Cache::poster_rel("ab12"), "media/ab12/poster.jpg");
    }
}
