/**
 * O que está sob o ponteiro na timeline. Coordenadas em px CSS relativas ao canvas.
 */
import type { Us } from "@/lib/time";
import { clipAt } from "@/project/queries";
import type { Id, Track } from "@/project/types";
import { RULER_HEIGHT, xToTime, type TrackLayout, type Viewport } from "./viewport";

export type Hit =
  | { area: "ruler"; t: Us }
  | { area: "track"; trackId: Id; clipId: Id | null; t: Us }
  | { area: "empty"; t: Us };

export function hitTest(x: number, y: number, vp: Viewport, scrollY: number, layout: TrackLayout, tracks: Track[]): Hit {
  const t = xToTime(x, vp);
  if (y < RULER_HEIGHT) return { area: "ruler", t };
  const rowY = y - RULER_HEIGHT + scrollY;
  const row = layout.rows.find((r) => rowY >= r.y && rowY < r.y + r.height);
  const track = row && tracks.find((tr) => tr.id === row.trackId);
  if (!track) return { area: "empty", t };
  return { area: "track", trackId: track.id, clipId: clipAt(track, t)?.id ?? null, t };
}
