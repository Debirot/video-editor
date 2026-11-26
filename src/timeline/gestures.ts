/**
 * Gestos do mouse na timeline. Cada arrasto que muda o projeto é uma transação:
 * o projeto atualiza ao vivo (o preview acompanha) e o histórico recebe uma única
 * entrada ao soltar. Esc durante o arrasto desfaz tudo e cancela.
 *
 * - régua: move o playhead (scrub)
 * - corpo do clipe: seleciona; arrastar move a seleção (e os ligados), inclusive entre trilhas
 * - borda do clipe: apara (o ligado junto)
 * - área vazia: seleção por retângulo (Ctrl soma à seleção atual)
 */
import { snapToFrame } from "@/lib/time";
import { projectStore } from "@/project/store";
import { clipEnd, withLinked } from "@/project/queries";
import { moveClips, trimBounds, trimClips, type Edge } from "@/project/commands/clips";
import type { Id, Project, Track } from "@/project/types";
import { viewStore } from "@/app/viewStore";
import { liveSelection, selectClip, selectionStore, setSelection } from "@/app/selectionStore";
import { clipsInRect, hitTest, trackAtY } from "./hitTest";
import { snapBlock, snapPoints, snapThreshold, snapTime } from "./snap";
import { clamp, trackLayout, xToTime, type Viewport } from "./viewport";

/** Pixels de movimento antes de um clique virar arrasto. */
const DRAG_THRESHOLD_PX = 4;

export interface Overlay {
  marquee: { x0: number; y0: number; x1: number; y1: number } | null;
  /** Prévia de mídia sendo arrastada da biblioteca. */
  ghosts: { trackId: Id; start: number; duration: number }[];
}

export interface GestureHost {
  canvas: HTMLCanvasElement;
  viewport: () => Viewport;
  overlay: Overlay;
  redraw: () => void;
}

type Gesture =
  | { kind: "scrub" }
  | { kind: "press"; clipId: Id; x0: number; y0: number; wasSelected: boolean }
  | {
      kind: "move";
      ids: Id[];
      x0: number;
      anchorTrack: Track;
      blockStart: number;
      blockEnd: number;
      points: number[];
    }
  | { kind: "trim"; ids: Id[]; edge: Edge; x0: number; origin: number; bounds: [number, number]; points: number[] }
  | { kind: "marquee"; x0: number; y0: number; base: Id[]; moved: boolean };

function project(): Project {
  return projectStore.getState().project;
}

function trackOf(p: Project, clipId: Id): Track | undefined {
  return p.tracks.find((t) => t.clips.some((c) => c.id === clipId));
}

function unlockedOnly(p: Project, ids: Id[]): Id[] {
  const locked = new Set(p.tracks.filter((t) => t.locked).flatMap((t) => t.clips.map((c) => c.id)));
  return ids.filter((id) => !locked.has(id));
}

export function attachGestures(host: GestureHost): () => void {
  const { canvas } = host;
  let gesture: Gesture | null = null;

  const snapOn = () => viewStore.getState().snap;
  const fps = () => project().settings.fps;
  const threshold = () => snapThreshold(viewStore.getState().pxPerSecond);
  const dxToUs = (dx: number) => Math.round((dx * 1_000_000) / viewStore.getState().pxPerSecond);

  /** Refaz a transação: volta ao estado do início do arrasto e aplica o novo passo. */
  const replay = (label: string, apply: () => void) => {
    const store = projectStore.getState();
    store.cancelTransaction();
    store.beginTransaction(label);
    apply();
  };

  const startMove = (g: Extract<Gesture, { kind: "press" }>): Gesture | null => {
    const p = project();
    const ids = unlockedOnly(p, withLinked(p, liveSelection()));
    const anchorTrack = trackOf(p, g.clipId);
    if (ids.length === 0 || !anchorTrack) return null;
    const clips = p.tracks.flatMap((t) => t.clips).filter((c) => ids.includes(c.id));
    projectStore.getState().beginTransaction("Mover clipes");
    canvas.style.cursor = "grabbing";
    return {
      kind: "move",
      ids,
      x0: g.x0,
      anchorTrack,
      blockStart: Math.min(...clips.map((c) => c.start)),
      blockEnd: Math.max(...clips.map(clipEnd)),
      points: snapPoints(p, new Set(ids), viewStore.getState().playhead),
    };
  };

  const updateMove = (g: Extract<Gesture, { kind: "move" }>, x: number, y: number) => {
    let delta = dxToUs(x - g.x0);
    if (snapOn()) delta += snapBlock(g.blockStart + delta, g.blockEnd + delta, g.points, threshold());
    delta = snapToFrame(g.blockStart + delta, fps()) - g.blockStart;
    delta = Math.max(delta, -g.blockStart);

    // Troca de trilha: só entre trilhas do mesmo tipo da trilha do clipe agarrado.
    const p = project();
    const sameKind = p.tracks.filter((t) => t.kind === g.anchorTrack.kind);
    const targetId = trackAtY(y, viewStore.getState().scrollY, trackLayout(p.tracks));
    const target = sameKind.find((t) => t.id === targetId);
    let by = target ? sameKind.indexOf(target) - sameKind.findIndex((t) => t.id === g.anchorTrack.id) : 0;
    if (target?.locked) by = 0;

    replay("Mover clipes", () =>
      projectStore.getState().applyCommand("Mover clipes", moveClips(g.ids, delta, { kind: g.anchorTrack.kind, by })),
    );
  };

  const startTrim = (clipId: Id, edge: Edge, x: number): Gesture | null => {
    const p = project();
    const ids = unlockedOnly(p, withLinked(p, [clipId]));
    const clip = p.tracks.flatMap((t) => t.clips).find((c) => c.id === clipId);
    const bounds = trimBounds(p, ids, edge, fps());
    if (!clip || !bounds || ids.length === 0) return null;
    setSelection(withLinked(p, [clipId]));
    projectStore.getState().beginTransaction("Aparar clipe");
    return {
      kind: "trim",
      ids,
      edge,
      x0: x,
      origin: edge === "start" ? clip.start : clipEnd(clip),
      bounds,
      points: snapPoints(p, new Set(ids), viewStore.getState().playhead),
    };
  };

  const updateTrim = (g: Extract<Gesture, { kind: "trim" }>, x: number) => {
    let t = g.origin + dxToUs(x - g.x0);
    if (snapOn()) t = snapTime(t, g.points, threshold()) ?? t;
    t = clamp(snapToFrame(t, fps()), g.bounds[0], g.bounds[1]);
    replay("Aparar clipe", () => projectStore.getState().applyCommand("Aparar clipe", trimClips(g.ids, g.edge, t)));
  };

  const updateMarquee = (g: Extract<Gesture, { kind: "marquee" }>, x: number, y: number) => {
    g.moved = true;
    host.overlay.marquee = { x0: g.x0, y0: g.y0, x1: x, y1: y };
    const p = project();
    const hits = clipsInRect(host.overlay.marquee, host.viewport(), viewStore.getState().scrollY, trackLayout(p.tracks), p.tracks);
    setSelection([...new Set([...g.base, ...withLinked(p, hits)])]);
    host.redraw();
  };

  const setPlayheadAt = (x: number) => {
    viewStore.setState({ playhead: snapToFrame(xToTime(x, host.viewport()), fps()) });
  };

  const finish = (commit: boolean) => {
    const store = projectStore.getState();
    if (gesture?.kind === "move" || gesture?.kind === "trim") {
      if (commit) store.commitTransaction();
      else store.cancelTransaction();
    }
    if (gesture?.kind === "marquee") {
      if (!commit) setSelection(gesture.base);
      host.overlay.marquee = null;
      host.redraw();
    }
    gesture = null;
    canvas.style.cursor = "";
  };

  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0 || gesture) return;
    const additive = e.ctrlKey || e.metaKey;
    const p = project();
    const hit = hitTest(e.offsetX, e.offsetY, host.viewport(), viewStore.getState().scrollY, trackLayout(p.tracks), p.tracks);
    canvas.setPointerCapture(e.pointerId);

    if (hit.area === "ruler") {
      gesture = { kind: "scrub" };
      setPlayheadAt(e.offsetX);
      return;
    }
    if (hit.area === "track" && hit.clipId && hit.edge && !additive) {
      gesture = startTrim(hit.clipId, hit.edge, e.offsetX);
      return;
    }
    if (hit.area === "track" && hit.clipId) {
      if (additive) {
        selectClip(hit.clipId, true);
        return;
      }
      const wasSelected = selectionStore.getState().clipIds.includes(hit.clipId);
      if (!wasSelected) selectClip(hit.clipId, false);
      gesture = { kind: "press", clipId: hit.clipId, x0: e.offsetX, y0: e.offsetY, wasSelected };
      return;
    }
    // Área vazia: retângulo de seleção (Ctrl mantém a seleção atual).
    const base = additive ? liveSelection() : [];
    if (!additive) setSelection([]);
    gesture = { kind: "marquee", x0: e.offsetX, y0: e.offsetY, base, moved: false };
  };

  const onPointerMove = (e: PointerEvent) => {
    const x = e.offsetX;
    const y = e.offsetY;
    if (!gesture) {
      // Cursor de acordo com o que está sob o ponteiro.
      const p = project();
      const hit = hitTest(x, y, host.viewport(), viewStore.getState().scrollY, trackLayout(p.tracks), p.tracks);
      const locked = hit.area === "track" && p.tracks.find((t) => t.id === hit.trackId)?.locked;
      canvas.style.cursor = hit.area === "track" && hit.clipId && !locked ? (hit.edge ? "ew-resize" : "grab") : "";
      return;
    }
    switch (gesture.kind) {
      case "scrub":
        return setPlayheadAt(clamp(x, 0, host.viewport().width));
      case "press":
        if (Math.hypot(x - gesture.x0, y - gesture.y0) >= DRAG_THRESHOLD_PX) {
          gesture = startMove(gesture);
          if (gesture?.kind === "move") updateMove(gesture, x, y);
        }
        return;
      case "move":
        return updateMove(gesture, x, y);
      case "trim":
        return updateTrim(gesture, x);
      case "marquee":
        if (gesture.moved || Math.hypot(x - gesture.x0, y - gesture.y0) >= DRAG_THRESHOLD_PX) updateMarquee(gesture, x, y);
        return;
    }
  };

  const onPointerUp = (e: PointerEvent) => {
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    // Clique (sem arrastar) num clipe já selecionado: fica só ele (e o ligado).
    if (gesture?.kind === "press" && gesture.wasSelected) selectClip(gesture.clipId, false);
    finish(true);
  };

  const onPointerCancel = () => finish(false);

  // Esc durante um arrasto cancela (captura antes do atalho "limpar seleção").
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== "Escape" || !gesture || gesture.kind === "scrub" || gesture.kind === "press") return;
    e.preventDefault();
    e.stopPropagation();
    finish(false);
  };

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerCancel);
  window.addEventListener("keydown", onKeyDown, { capture: true });
  return () => {
    finish(false);
    canvas.removeEventListener("pointerdown", onPointerDown);
    canvas.removeEventListener("pointermove", onPointerMove);
    canvas.removeEventListener("pointerup", onPointerUp);
    canvas.removeEventListener("pointercancel", onPointerCancel);
    window.removeEventListener("keydown", onKeyDown, { capture: true });
  };
}
