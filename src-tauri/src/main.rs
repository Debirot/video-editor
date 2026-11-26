// Sem janela de console no Windows em release.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod protocol;

use tauri::Manager;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(protocol::MediaState::default())
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
        ])
        .run(tauri::generate_context!())
        .expect("erro ao iniciar o app");
}
