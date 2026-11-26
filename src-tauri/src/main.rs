// Sem janela de console no Windows em release.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod cache;
mod commands;
mod ffmpeg;
mod jobs;
mod media;
mod project_io;
mod protocol;
mod time;

use std::sync::Arc;

use tauri::Manager;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(protocol::MediaState::default())
        .manage(Arc::new(jobs::JobQueue::default()))
        .setup(|app| {
            let root = app.path().app_cache_dir()?;
            std::fs::create_dir_all(&root)?;
            app.state::<protocol::MediaState>()
                .set_cache_root(root.clone());
            app.manage(cache::Cache::new(root));
            Ok(())
        })
        .register_asynchronous_uri_scheme_protocol("media", |ctx, request, responder| {
            // Leitura e escrita de disco fora da thread do WebView.
            let app = ctx.app_handle().clone();
            tauri::async_runtime::spawn_blocking(move || {
                let state = app.state::<protocol::MediaState>();
                responder.respond(protocol::handle(&state, request));
            });
        })
        .invoke_handler(tauri::generate_handler![
            commands::allow_media,
            commands::begin_export,
            commands::finish_export,
            commands::cancel_export,
            commands::import_media,
            commands::save_project,
            commands::open_project,
            commands::recent_projects,
            commands::attach_media,
        ])
        .run(tauri::generate_context!())
        .expect("erro ao iniciar o app");
}
