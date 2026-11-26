/**
 * Fluxo da exportação: abrir o diálogo, escolher o arquivo, acompanhar e cancelar.
 * O Rust abre um arquivo `.partial` (begin_export), o Worker grava pelo media:// e,
 * no fim, o Rust renomeia (finish_export) ou apaga (cancel_export).
 */
import { createStore } from "zustand/vanilla";
import { useStore } from "zustand";
import { save } from "@tauri-apps/plugin-dialog";
import type { ExportCapabilities, ExportResult, ExportSettings } from "@/engine/messages";
import { ipc, isTauri, mediaWriteUrl } from "@/lib/ipc";
import { projectStore } from "@/project/store";
import { projectDuration } from "@/project/queries";
import { cancelProjectExport, exportCapabilities, startProjectExport, type ExportEvent } from "./engine";

export type ExportStatus =
  | { kind: "setup" }
  | { kind: "running"; done: number; total: number; startedAt: number; elapsedMs: number }
  | { kind: "cancelling" }
  | { kind: "done"; result: ExportResult; path: string; bytes: number }
  | { kind: "error"; message: string };

interface ExportState {
  open: boolean;
  status: ExportStatus;
  caps: ExportCapabilities | null;
}

export const exportStore = createStore<ExportState>()(() => ({ open: false, status: { kind: "setup" }, caps: null }));

export function useExport<T>(selector: (s: ExportState) => T): T {
  return useStore(exportStore, selector);
}

let exportId: number | null = null;
let exportPath = "";

export function openExportDialog(): void {
  const { project } = projectStore.getState();
  if (projectDuration(project) === 0 || exportStore.getState().status.kind === "running") {
    exportStore.setState({ open: projectDuration(project) > 0 });
    return;
  }
  exportStore.setState({ open: true, status: { kind: "setup" } });
  const { width, height, fps } = project.settings;
  void exportCapabilities(width, height, fps).then((caps) => exportStore.setState({ caps }));
}

/** Fechar só é permitido fora da exportação (para parar, use Cancelar). */
export function closeExportDialog(): void {
  if (exportStore.getState().status.kind === "running") return;
  exportStore.setState({ open: false });
}

function onEvent(e: ExportEvent): void {
  switch (e.type) {
    case "export:progress": {
      const s = exportStore.getState().status;
      const startedAt = s.kind === "running" ? s.startedAt : performance.now();
      const elapsedMs = performance.now() - startedAt;
      exportStore.setState({ status: { kind: "running", done: e.done, total: e.total, startedAt, elapsedMs } });
      return;
    }
    case "export:done":
      void finish(e.result);
      return;
    case "export:cancelled":
      void abandon({ kind: "setup" });
      return;
    case "export:error":
      void abandon({ kind: "error", message: e.message });
      return;
  }
}

async function finish(result: ExportResult): Promise<void> {
  const id = exportId;
  exportId = null;
  if (id === null) return;
  try {
    const bytes = await ipc.finishExport(id);
    exportStore.setState({ status: { kind: "done", result, path: exportPath, bytes } });
  } catch (e) {
    exportStore.setState({ status: { kind: "error", message: String(e) } });
  }
}

/** Apaga o arquivo parcial e volta ao estado indicado. */
async function abandon(next: ExportStatus): Promise<void> {
  const id = exportId;
  exportId = null;
  if (id !== null) await ipc.cancelExport(id).catch(() => {});
  exportStore.setState({ status: next });
}

export async function startExport(settings: Omit<ExportSettings, "durationUs">): Promise<void> {
  if (!isTauri()) return;
  const { project } = projectStore.getState();
  const path = await save({
    title: "Exportar vídeo",
    defaultPath: `${project.name || "video"}.mp4`,
    filters: [{ name: "Vídeo MP4", extensions: ["mp4"] }],
  });
  if (!path) return;
  const finalPath = /\.mp4$/i.test(path) ? path : `${path}.mp4`;
  try {
    exportId = await ipc.beginExport(finalPath);
  } catch (e) {
    exportStore.setState({ status: { kind: "error", message: String(e) } });
    return;
  }
  exportPath = finalPath;
  exportStore.setState({ status: { kind: "running", done: 0, total: 0, startedAt: performance.now(), elapsedMs: 0 } });
  startProjectExport(project, { ...settings, durationUs: projectDuration(project) }, mediaWriteUrl(exportId), onEvent);
}

export function cancelExport(): void {
  if (exportStore.getState().status.kind !== "running") return;
  exportStore.setState({ status: { kind: "cancelling" } });
  cancelProjectExport();
}
