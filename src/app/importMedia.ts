/**
 * Fluxo de importação: escolher ou soltar arquivos → Rust (fingerprint, ffprobe,
 * pôster na fila) → mídias no projeto por applyCommand → Worker verifica se o
 * WebCodecs decodifica cada vídeo.
 */
import { open } from "@tauri-apps/plugin-dialog";
import { ipc, mediaCacheUrl, mediaReadUrl, onJobDone, type ImportedMedia } from "@/lib/ipc";
import { newId } from "@/lib/ids";
import { projectStore } from "@/project/store";
import { addMedia, sameFile } from "@/project/commands/media";
import type { Media } from "@/project/types";
import { checkDecodable } from "./engine";
import { patchRuntime, runtimeStore, type ImportError } from "./mediaRuntime";

export const MEDIA_EXTENSIONS = [
  "mp4", "mov", "m4v", "mkv", "webm", "avi", "mts", "m2ts", "mxf",
  "mp3", "wav", "m4a", "aac", "flac", "ogg", "opus",
  "png", "jpg", "jpeg", "webp", "bmp", "gif", "tif", "tiff",
];

function extension(path: string): string {
  return /\.([^.\\/]+)$/.exec(path)?.[1]?.toLowerCase() ?? "";
}

export function fileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

function toMedia(m: ImportedMedia): Media {
  return {
    id: newId("m"),
    kind: m.kind,
    path: m.path,
    relPath: null, // calculado ao salvar o projeto (T1.09)
    fingerprint: m.fingerprint,
    probe: m.probe,
    proxy: { status: "none" },
    binId: null,
  };
}

export async function pickAndImport(): Promise<void> {
  const picked = await open({
    multiple: true,
    title: "Importar mídia",
    filters: [{ name: "Vídeo, áudio e imagem", extensions: MEDIA_EXTENSIONS }],
  });
  if (!picked) return;
  await importPaths(Array.isArray(picked) ? picked : [picked]);
}

export async function importPaths(paths: string[]): Promise<void> {
  const errors: ImportError[] = [];
  const accepted = paths.filter((p) => {
    const ok = MEDIA_EXTENSIONS.includes(extension(p));
    if (!ok) errors.push({ path: p, error: "formato não suportado" });
    return ok;
  });

  const added: Media[] = [];
  if (accepted.length > 0) {
    runtimeStore.setState((s) => ({ importing: s.importing + accepted.length }));
    try {
      const outcomes = await ipc.importMedia(accepted);
      const project = projectStore.getState().project;
      for (const o of outcomes) {
        if (o.status === "failed") {
          errors.push({ path: o.path, error: o.error });
          continue;
        }
        const media = toMedia(o.media);
        const hash = media.fingerprint.partialHash;
        const current = runtimeStore.getState().byHash[hash];
        // O pôster pode ter ficado pronto antes desta resposta chegar.
        if (current?.poster !== "ready") {
          patchRuntime(hash, o.media.poster
            ? { poster: "ready", posterUrl: mediaCacheUrl(o.media.poster) }
            : { poster: o.media.posterPending ? "pending" : "none" });
        }
        if (project.media.some((m) => sameFile(m, media)) || added.some((m) => sameFile(m, media))) continue;
        added.push(media);
      }
    } catch (e) {
      for (const p of accepted) errors.push({ path: p, error: String(e) });
    } finally {
      runtimeStore.setState((s) => ({ importing: s.importing - accepted.length }));
    }
  }

  if (added.length > 0) {
    const label = added.length === 1 ? "Importar mídia" : `Importar ${added.length} mídias`;
    projectStore.getState().applyCommand(label, addMedia(added));
    for (const m of added) {
      if (m.kind === "video") void checkVideo(m);
    }
  }
  if (errors.length > 0) runtimeStore.setState((s) => ({ errors: [...s.errors, ...errors] }));
}

async function checkVideo(media: Media): Promise<void> {
  const hash = media.fingerprint.partialHash;
  patchRuntime(hash, { decode: "checking" });
  const r = await checkDecodable(mediaReadUrl(media.path));
  patchRuntime(hash, { decode: r.decodable ? "ok" : "unsupported", hardware: r.hardware === "prefer-hardware" });
}

/** Atualiza pôsteres quando a fila do Rust termina. Chamar uma vez ao abrir o app. */
export function listenForJobs(): Promise<() => void> {
  return onJobDone((e) => {
    if (e.kind !== "poster") return;
    patchRuntime(
      e.mediaHash,
      e.ok && e.output ? { poster: "ready", posterUrl: mediaCacheUrl(e.output) } : { poster: "failed" },
    );
  });
}
