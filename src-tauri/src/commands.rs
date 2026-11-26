//! Todos os comandos que a interface pode chamar (`invoke`).
//! Funções curtas: validam a entrada e delegam aos módulos.
//! Os wrappers tipados do lado TypeScript ficam em src/lib/ipc.ts.

use std::path::PathBuf;

use tauri::State;

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
