/**
 * Encaixe: ao arrastar, bordas grudam em bordas de outros clipes, no playhead e no zero
 * quando chegam a menos de SNAP_PX pixels. Funções puras.
 */
import type { Us } from "@/lib/time";
import { clipEnd } from "@/project/queries";
import type { Id, Project } from "@/project/types";

export const SNAP_PX = 8;

/** Pontos de encaixe: 0, playhead e inícios/fins dos clipes que não estão sendo arrastados. */
export function snapPoints(project: Project, exclude: Set<Id>, playhead: Us): Us[] {
  const points = new Set<Us>([0, playhead]);
  for (const track of project.tracks) {
    for (const c of track.clips) {
      if (exclude.has(c.id)) continue;
      points.add(c.start);
      points.add(clipEnd(c));
    }
  }
  for (const m of project.markers) points.add(m.time);
  return [...points];
}

/** Ponto mais próximo de t dentro de `threshold` µs, ou null. */
export function snapTime(t: Us, points: Us[], threshold: Us): Us | null {
  let best: Us | null = null;
  let bestDist = threshold;
  for (const p of points) {
    const d = Math.abs(p - t);
    if (d <= bestDist) {
      best = p;
      bestDist = d;
    }
  }
  return best;
}

/**
 * Ajuste para encaixar um bloco [start, end) que está sendo arrastado: a borda
 * (início ou fim) mais perto de um ponto vence. Devolve o quanto somar ao deslocamento.
 */
export function snapBlock(start: Us, end: Us, points: Us[], threshold: Us): Us {
  const s = snapTime(start, points, threshold);
  const e = snapTime(end, points, threshold);
  const ds = s === null ? Infinity : s - start;
  const de = e === null ? Infinity : e - end;
  if (ds === Infinity && de === Infinity) return 0;
  return Math.abs(ds) <= Math.abs(de) ? ds : de;
}

/** Limiar em µs equivalente a SNAP_PX no zoom atual. */
export function snapThreshold(pxPerSecond: number): Us {
  return Math.round((SNAP_PX * 1_000_000) / pxPerSecond);
}
