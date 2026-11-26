//! Arquivos de projeto: pasta `<nome>.vproj/` com `project.json`, e a lista de recentes.
//!
//! O Rust não interpreta o conteúdo do projeto (isso é do TypeScript, normalizeProject):
//! só lê e grava texto, sempre de forma atômica (arquivo temporário + rename), para que
//! uma queda no meio da gravação nunca deixe um project.json pela metade.

use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

pub const PROJECT_FILE: &str = "project.json";
pub const MAX_RECENT: usize = 10;

/// Grava `contents` em `path` de forma atômica: escreve `<path>.tmp`, força para o disco
/// e renomeia por cima (no Windows o rename substitui o destino).
pub fn write_atomic(path: &Path, contents: &[u8]) -> io::Result<()> {
    let mut tmp = path.as_os_str().to_owned();
    tmp.push(".tmp");
    let tmp = PathBuf::from(tmp);
    {
        let mut f = fs::File::create(&tmp)?;
        f.write_all(contents)?;
        f.sync_all()?;
    }
    fs::rename(&tmp, path).inspect_err(|_| {
        let _ = fs::remove_file(&tmp);
    })
}

/// Pasta do projeto a partir do que o usuário escolheu: a própria pasta `.vproj`, o
/// `project.json` dentro dela, ou um caminho sem extensão (ganha `.vproj`).
pub fn project_dir(chosen: &Path) -> PathBuf {
    if chosen.file_name().is_some_and(|n| n == PROJECT_FILE) {
        return chosen.parent().map(Path::to_path_buf).unwrap_or_default();
    }
    if chosen
        .extension()
        .is_some_and(|e| e.eq_ignore_ascii_case("vproj"))
    {
        return chosen.to_path_buf();
    }
    let mut s = chosen.as_os_str().to_owned();
    s.push(".vproj");
    PathBuf::from(s)
}

/// Cria a pasta (se preciso) e grava o project.json. Devolve a pasta.
pub fn save(chosen: &Path, json: &str) -> io::Result<PathBuf> {
    let dir = project_dir(chosen);
    fs::create_dir_all(&dir)?;
    write_atomic(&dir.join(PROJECT_FILE), json.as_bytes())?;
    Ok(dir)
}

/// Lê o project.json. Devolve a pasta e o texto.
pub fn open(chosen: &Path) -> io::Result<(PathBuf, String)> {
    let dir = project_dir(chosen);
    let file = dir.join(PROJECT_FILE);
    let json = fs::read_to_string(&file).map_err(|e| {
        if e.kind() == io::ErrorKind::NotFound {
            io::Error::new(
                io::ErrorKind::NotFound,
                format!("não há {PROJECT_FILE} em {}", dir.display()),
            )
        } else {
            e
        }
    })?;
    Ok((dir, json))
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentProject {
    pub path: PathBuf,
    pub name: String,
    /// Segundos desde 1970.
    pub opened_at: u64,
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_secs())
}

/// Lista de recentes gravada em `file`. Arquivo ausente ou inválido = lista vazia.
pub fn read_recent(file: &Path) -> Vec<RecentProject> {
    fs::read_to_string(file)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

/// Põe o projeto no topo da lista (sem repetir), limitada a MAX_RECENT.
pub fn add_recent(file: &Path, dir: &Path, name: &str) -> io::Result<Vec<RecentProject>> {
    let mut list = read_recent(file);
    list.retain(|r| r.path != dir);
    list.insert(
        0,
        RecentProject {
            path: dir.to_path_buf(),
            name: name.to_string(),
            opened_at: now_secs(),
        },
    );
    list.truncate(MAX_RECENT);
    if let Some(parent) = file.parent() {
        fs::create_dir_all(parent)?;
    }
    write_atomic(file, serde_json::to_string_pretty(&list)?.as_bytes())?;
    Ok(list)
}

/// Recentes cuja pasta ainda existe.
pub fn existing_recent(file: &Path) -> Vec<RecentProject> {
    read_recent(file)
        .into_iter()
        .filter(|r| r.path.join(PROJECT_FILE).is_file())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dir_from_choice() {
        assert_eq!(
            project_dir(Path::new("C:/P/Viagem.vproj")),
            PathBuf::from("C:/P/Viagem.vproj")
        );
        assert_eq!(
            project_dir(Path::new("C:/P/Viagem.VPROJ")),
            PathBuf::from("C:/P/Viagem.VPROJ")
        );
        assert_eq!(
            project_dir(Path::new("C:/P/Viagem.vproj/project.json")),
            PathBuf::from("C:/P/Viagem.vproj")
        );
        assert_eq!(
            project_dir(Path::new("C:/P/Viagem")),
            PathBuf::from("C:/P/Viagem.vproj")
        );
    }

    #[test]
    fn save_then_open_and_overwrite() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = save(&tmp.path().join("Viagem"), r#"{"a":1}"#).unwrap();
        assert_eq!(dir, tmp.path().join("Viagem.vproj"));
        assert_eq!(open(&dir).unwrap().1, r#"{"a":1}"#);
        save(&dir, r#"{"a":2}"#).unwrap();
        let (d2, json) = open(&dir.join(PROJECT_FILE)).unwrap();
        assert_eq!((d2, json.as_str()), (dir.clone(), r#"{"a":2}"#));
        // Nenhum temporário sobrando.
        let names: Vec<_> = fs::read_dir(&dir)
            .unwrap()
            .map(|e| e.unwrap().file_name())
            .collect();
        assert_eq!(names, vec![std::ffi::OsString::from(PROJECT_FILE)]);
    }

    #[test]
    fn open_missing_explains() {
        let tmp = tempfile::tempdir().unwrap();
        let err = open(&tmp.path().join("Nada.vproj")).unwrap_err();
        assert_eq!(err.kind(), io::ErrorKind::NotFound);
        assert!(err.to_string().contains("project.json"));
    }

    #[test]
    fn recent_list_dedups_limits_and_filters() {
        let tmp = tempfile::tempdir().unwrap();
        let file = tmp.path().join("config").join("recent.json");
        assert!(read_recent(&file).is_empty());

        let mut dirs = Vec::new();
        for i in 0..12 {
            let d = save(&tmp.path().join(format!("P{i}")), "{}").unwrap();
            add_recent(&file, &d, &format!("Projeto {i}")).unwrap();
            dirs.push(d);
        }
        let list = read_recent(&file);
        assert_eq!(list.len(), MAX_RECENT);
        assert_eq!(list[0].name, "Projeto 11");

        // Reabrir um antigo sobe para o topo sem duplicar.
        add_recent(&file, &dirs[5], "Projeto 5").unwrap();
        let list = read_recent(&file);
        assert_eq!(list[0].path, dirs[5]);
        assert_eq!(list.iter().filter(|r| r.path == dirs[5]).count(), 1);

        // Pasta apagada some da lista exibida.
        fs::remove_dir_all(&dirs[5]).unwrap();
        assert!(existing_recent(&file).iter().all(|r| r.path != dirs[5]));

        // Arquivo corrompido = lista vazia, sem erro.
        fs::write(&file, "isto não é json").unwrap();
        assert!(read_recent(&file).is_empty());
    }
}
