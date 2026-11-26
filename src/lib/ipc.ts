/**
 * Wrappers tipados para os comandos do Rust (src-tauri/src/commands.rs).
 * Todo nome de comando e evento fica aqui; nenhum outro arquivo chama invoke().
 */
import { convertFileSrc, invoke, isTauri } from "@tauri-apps/api/core";

export { isTauri };

export const ipc = {
  /** Autoriza o protocolo media:// a servir este arquivo (escolhido pelo usuário). */
  allowMedia: (path: string) => invoke<void>("allow_media", { path }),
  /** Abre uma sessão de escrita para exportação. Grava em "<path>.partial" até finishExport. */
  beginExport: (path: string) => invoke<number>("begin_export", { path }),
  /** Fecha o arquivo e renomeia para o caminho final. Devolve o tamanho em bytes. */
  finishExport: (id: number) => invoke<number>("finish_export", { id }),
  /** Fecha e apaga o arquivo parcial. */
  cancelExport: (id: number) => invoke<void>("cancel_export", { id }),
};

/**
 * Base do protocolo media://. No Windows o WebView2 usa "http://media.localhost/",
 * no macOS e no Linux "media://localhost/". convertFileSrc resolve isso.
 */
export function mediaBaseUrl(): string {
  const base = convertFileSrc("", "media");
  return base.endsWith("/") ? base : `${base}/`;
}

export function mediaReadUrl(path: string): string {
  return `${mediaBaseUrl()}file/${encodeURIComponent(path)}`;
}

export function mediaWriteUrl(exportId: number): string {
  return `${mediaBaseUrl()}write/${exportId}`;
}
