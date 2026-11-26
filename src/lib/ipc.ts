/**
 * Wrappers tipados para os comandos do Rust (src-tauri/src/commands.rs).
 * Todo nome de comando e evento fica aqui; nenhum outro arquivo chama invoke() ou listen().
 */
import { convertFileSrc, invoke, isTauri } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import type { MediaKind, MediaProbe } from "@/project/types";

export { isTauri };

/** Espelha media::ImportedMedia. */
export interface ImportedMedia {
  path: string;
  kind: MediaKind;
  fingerprint: { size: number; mtime: number; partialHash: string };
  probe: MediaProbe;
  /** Caminho relativo no cache quando o pôster já existe. */
  poster: string | null;
  /** O pôster está na fila; chega pelo evento job:done. */
  posterPending: boolean;
}

export type ImportOutcome =
  | { status: "ok"; media: ImportedMedia }
  | { status: "failed"; path: string; error: string };

/** Evento job:done (commands::JobDone). */
export interface JobDone {
  key: string;
  kind: "poster";
  mediaHash: string;
  ok: boolean;
  error: string | null;
  output: string | null;
}

export const ipc = {
  /** Autoriza o protocolo media:// a servir este arquivo (escolhido pelo usuário). */
  allowMedia: (path: string) => invoke<void>("allow_media", { path }),
  /** Abre uma sessão de escrita para exportação. Grava em "<path>.partial" até finishExport. */
  beginExport: (path: string) => invoke<number>("begin_export", { path }),
  /** Fecha o arquivo e renomeia para o caminho final. Devolve o tamanho em bytes. */
  finishExport: (id: number) => invoke<number>("finish_export", { id }),
  /** Fecha e apaga o arquivo parcial. */
  cancelExport: (id: number) => invoke<void>("cancel_export", { id }),
  /** ffprobe + fingerprint de cada arquivo; autoriza a leitura e enfileira pôsteres. */
  importMedia: (paths: string[]) => invoke<ImportOutcome[]>("import_media", { paths }),
};

export function onJobDone(handler: (e: JobDone) => void): Promise<UnlistenFn> {
  return listen<JobDone>("job:done", (ev) => handler(ev.payload));
}

export type FileDropEvent = { type: "enter"; paths: string[] } | { type: "over" } | { type: "drop"; paths: string[] } | { type: "leave" };

/** Arquivos arrastados do sistema para a janela (o HTML5 drop não dá caminhos no Tauri). */
export function onFileDrop(handler: (e: FileDropEvent) => void): Promise<UnlistenFn> {
  return getCurrentWebview().onDragDropEvent((ev) => {
    const p = ev.payload;
    if (p.type === "enter" || p.type === "drop") handler({ type: p.type, paths: p.paths });
    else handler({ type: p.type });
  });
}

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

/** URL de um arquivo da pasta de cache (ex.: "media/<hash>/poster.jpg"). */
export function mediaCacheUrl(rel: string): string {
  return `${mediaBaseUrl()}cache/${rel.split("/").map(encodeURIComponent).join("/")}`;
}
