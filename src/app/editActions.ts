/**
 * Ações de edição disparadas por atalhos e botões. Cada uma lê os stores e,
 * quando muda o projeto, passa por applyCommand (um passo de desfazer).
 */
import { newId } from "@/lib/ids";
import { frameToUs, snapToFrame, usToFrame } from "@/lib/time";
import { projectStore } from "@/project/store";
import { clipEnd, nextCut, projectDuration, withLinked } from "@/project/queries";
import { copyClips, deleteClips, pasteClips, splitClips } from "@/project/commands/clips";
import { clamp, clampScrollX, fitZoom, timeToX, zoomAt, type Viewport } from "@/timeline/viewport";
import { pickAndImport } from "./importMedia";
import { isTauri } from "@/lib/ipc";
import { liveSelection, selectionStore, setSelection } from "./selectionStore";
import type { Action } from "./shortcuts";
import { viewStore } from "./viewStore";
import { pause, shuttle, togglePlay } from "./engine";
import { newProject, openProjectDialog, saveProject, saveProjectAs } from "./projectFile";

function viewport(): Viewport {
  const v = viewStore.getState();
  return { pxPerSecond: v.pxPerSecond, scrollX: v.scrollX, width: v.viewportWidth };
}

/** Move o playhead (no início de um quadro) e rola a timeline se ele sair da tela. */
export function setPlayhead(t: number): void {
  const fps = projectStore.getState().project.settings.fps;
  const playhead = Math.max(0, snapToFrame(t, fps));
  const vp = viewport();
  const x = timeToX(playhead, vp);
  const margin = vp.width * 0.1;
  let scrollX = vp.scrollX;
  if (vp.width > 0 && (x < margin || x > vp.width - margin)) {
    scrollX = Math.max(0, vp.scrollX + x - vp.width / 2);
  }
  viewStore.setState({ playhead, scrollX });
}

/** Zoom ancorado no playhead se ele estiver visível, senão no centro. */
export function zoomBy(factor: number): void {
  const v = viewStore.getState();
  const vp = viewport();
  const playheadX = timeToX(v.playhead, vp);
  const anchor = playheadX >= 0 && playheadX <= vp.width ? playheadX : vp.width / 2;
  const z = zoomAt(vp, factor, anchor);
  const content = projectDuration(projectStore.getState().project);
  viewStore.setState({ pxPerSecond: z.pxPerSecond, scrollX: clampScrollX(z.scrollX, content, { ...vp, ...z }) });
}

export function zoomToFit(): void {
  const content = projectDuration(projectStore.getState().project);
  viewStore.setState({ pxPerSecond: fitZoom(content, viewStore.getState().viewportWidth), scrollX: 0 });
}

function selectedWithLinked(): string[] {
  return withLinked(projectStore.getState().project, liveSelection());
}

/** Cola entradas em `at`, seleciona o que foi colado e leva o playhead para o fim. */
function paste(label: string, entries: ReturnType<typeof copyClips>, at: number): void {
  if (entries.length === 0) return;
  const ids = entries.map(() => newId("c"));
  projectStore.getState().applyCommand(label, pasteClips(entries, at, ids));
  const base = Math.min(...entries.map((e) => e.clip.start));
  const span = Math.max(...entries.map((e) => clipEnd(e.clip))) - base;
  const existing = new Set(projectStore.getState().project.tracks.flatMap((t) => t.clips.map((c) => c.id)));
  setSelection(ids.filter((id) => existing.has(id)));
  setPlayhead(at + span);
}

export function splitAtPlayhead(): void {
  const ids = selectedWithLinked();
  if (ids.length === 0) return;
  const rightIds = Object.fromEntries(ids.map((id) => [id, newId("c")]));
  projectStore.getState().applyCommand("Dividir clipe", splitClips(ids, viewStore.getState().playhead, rightIds));
}

export function runAction(action: Action): void {
  const store = projectStore.getState();
  const project = store.project;
  const fps = project.settings.fps;
  const playhead = viewStore.getState().playhead;

  // Navegar pelo tempo pausa a reprodução, como nos editores de vídeo.
  const navigation: Action[] = ["frameBack", "frameForward", "secondBack", "secondForward", "prevCut", "nextCut", "goStart", "goEnd"];
  if (navigation.includes(action)) pause();

  switch (action) {
    case "save":
      void saveProject();
      return;
    case "saveAs":
      void saveProjectAs();
      return;
    case "open":
      void openProjectDialog();
      return;
    case "newProject":
      void newProject();
      return;
    case "togglePlay":
      return togglePlay();
    case "shuttleBack":
      return shuttle(-1);
    case "shuttleForward":
      return shuttle(1);
    case "stop":
      return pause();
    case "undo":
      return store.undo();
    case "redo":
      return store.redo();
    case "split":
      return splitAtPlayhead();
    case "delete":
    case "rippleDelete": {
      const ids = selectedWithLinked();
      if (ids.length === 0) return;
      const ripple = action === "rippleDelete";
      store.applyCommand(ripple ? "Apagar fechando o espaço" : "Apagar clipes", deleteClips(ids, ripple));
      setSelection([]);
      return;
    }
    case "copy": {
      const ids = selectedWithLinked();
      if (ids.length > 0) selectionStore.setState({ clipboard: copyClips(project, ids) });
      return;
    }
    case "paste":
      return paste("Colar", selectionStore.getState().clipboard, playhead);
    case "duplicate": {
      const entries = copyClips(project, selectedWithLinked());
      if (entries.length === 0) return;
      return paste("Duplicar", entries, Math.max(...entries.map((e) => clipEnd(e.clip))));
    }
    case "selectAll":
      return setSelection(project.tracks.filter((t) => !t.locked).flatMap((t) => t.clips.map((c) => c.id)));
    case "deselect":
      return setSelection([]);
    case "frameBack":
    case "frameForward": {
      const frame = usToFrame(playhead, fps) + (action === "frameForward" ? 1 : -1);
      return setPlayhead(frameToUs(Math.max(0, frame), fps));
    }
    case "secondBack":
    case "secondForward":
      return setPlayhead(playhead + (action === "secondForward" ? 1_000_000 : -1_000_000));
    case "prevCut":
    case "nextCut": {
      const t = nextCut(project, playhead, action === "nextCut" ? 1 : -1);
      if (t !== undefined) setPlayhead(t);
      return;
    }
    case "goStart":
      return setPlayhead(0);
    case "goEnd":
      return setPlayhead(clamp(projectDuration(project), 0, Number.MAX_SAFE_INTEGER));
    case "toggleSnap":
      return viewStore.setState((s) => ({ snap: !s.snap }));
    case "zoomIn":
      return zoomBy(1.5);
    case "zoomOut":
      return zoomBy(1 / 1.5);
    case "zoomFit":
      return zoomToFit();
    case "import":
      if (isTauri()) void pickAndImport();
      return;
  }
}
