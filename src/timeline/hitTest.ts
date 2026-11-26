/**
 * O que está sob o ponteiro na timeline. Coordenadas em px CSS relativas ao canvas.
 */
import type { Us } from "@/lib/time";
import { clipAt, clipEnd } from "@/project/queries";
import type { Id, Track } from "@/project/types";
import { RULER_HEIGHT, timeToX, xToTime, type TrackLayout, type Viewport } from "./viewport";

/** Distância em px da borda de um clipe que vale como "pegar a borda" (aparar). */
export const EDGE_PX = 6;

export type Hit =
  | { area: "ruler"; t: Us }
  | { area: "track"; trackId: Id; clipId: Id | null; edge: "start" | "end" | null; t: Us }
  | { area: "empty"; t: Us };

export function hitTest(x: number, y: number, vp: Viewport, scrollY: number, layout: TrackLayout, tracks: Track[]): Hit {
  const t = xToTime(x, vp);
  if (y < RULER_HEIGHT) return { area: "ruler", t };
  const rowY = y - RULER_HEIGHT + scrollY;
  const row = layout.rows.find((r) => rowY >= r.y && rowY < r.y + r.height);
  const track = row && tracks.find((tr) => tr.id === row.trackId);
  if (!track) return { area: "empty", t };

  // Bordas primeiro: perto do encontro de dois clipes, vale a borda do mais próximo.
  // Clipes estreitos (< 3 × EDGE_PX) só têm corpo, para ainda dar para arrastá-los.
  let best: { clipId: Id; edge: "start" | "end"; dist: number } | null = null;
  for (const c of track.clips) {
    const x0 = timeToX(c.start, vp);
    const x1 = timeToX(clipEnd(c), vp);
    if (x1 < x - EDGE_PX || x0 > x + EDGE_PX || x1 - x0 < EDGE_PX * 3) continue;
    for (const [edge, ex] of [["start", x0], ["end", x1]] as const) {
      if (Math.abs(x - ex) > EDGE_PX) continue;
      // Por fora da borda também vale, mas perde para a borda do clipe em que o ponteiro está.
      const inside = edge === "start" ? x >= ex : x <= ex;
      const dist = Math.abs(x - ex) + (inside ? 0 : 0.5);
      if (!best || dist < best.dist) best = { clipId: c.id, edge, dist };
    }
  }
  if (best) return { area: "track", trackId: track.id, clipId: best.clipId, edge: best.edge, t };
  return { area: "track", trackId: track.id, clipId: clipAt(track, t)?.id ?? null, edge: null, t };
}

/** Linha (trilha) sob y, sem descontar nada além da régua e da rolagem; null fora das trilhas. */
export function trackAtY(y: number, scrollY: number, layout: TrackLayout): Id | null {
  const rowY = y - RULER_HEIGHT + scrollY;
  return layout.rows.find((r) => rowY >= r.y && rowY < r.y + r.height)?.trackId ?? null;
}

/** Clipes que tocam o retângulo [x0,x1]×[y0,y1] (px do canvas), para seleção por retângulo. */
export function clipsInRect(
  rect: { x0: number; y0: number; x1: number; y1: number },
  vp: Viewport,
  scrollY: number,
  layout: TrackLayout,
  tracks: Track[],
): Id[] {
  const [xa, xb] = [Math.min(rect.x0, rect.x1), Math.max(rect.x0, rect.x1)];
  const [ya, yb] = [Math.min(rect.y0, rect.y1), Math.max(rect.y0, rect.y1)];
  const ta = xToTime(xa, vp);
  const tb = xToTime(xb, vp);
  const out: Id[] = [];
  for (const row of layout.rows) {
    const top = row.y + RULER_HEIGHT - scrollY;
    if (top + row.height <= ya || top >= yb) continue;
    const track = tracks.find((t) => t.id === row.trackId);
    if (!track || track.locked) continue;
    for (const c of track.clips) if (c.start < tb && clipEnd(c) > ta) out.push(c.id);
  }
  return out;
}
