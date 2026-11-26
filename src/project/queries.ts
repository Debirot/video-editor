/**
 * Funções puras de leitura do projeto. Nunca alteram nada.
 */
import type { Clip, Id, Media, Project, Track, Us } from "./types";

export function findTrack(project: Project, trackId: Id): Track | undefined {
  return project.tracks.find((t) => t.id === trackId);
}

export function findMedia(project: Project, mediaId: Id): Media | undefined {
  return project.media.find((m) => m.id === mediaId);
}

export function findClip(project: Project, clipId: Id): { track: Track; clip: Clip; index: number } | undefined {
  for (const track of project.tracks) {
    const index = track.clips.findIndex((c) => c.id === clipId);
    if (index >= 0) return { track, clip: track.clips[index]!, index };
  }
  return undefined;
}

export function clipEnd(clip: Clip): Us {
  return clip.start + clip.duration;
}

/**
 * Clipe que cobre o instante t (start <= t < fim) numa trilha.
 * As trilhas são ordenadas e sem sobreposição, então a busca é binária.
 */
export function clipAt(track: Track, t: Us): Clip | undefined {
  const clips = track.clips;
  let lo = 0;
  let hi = clips.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const c = clips[mid]!;
    if (t < c.start) hi = mid - 1;
    else if (t >= clipEnd(c)) lo = mid + 1;
    else return c;
  }
  return undefined;
}

/** Fim do último clipe de qualquer trilha. */
export function projectDuration(project: Project): Us {
  let end = 0;
  for (const track of project.tracks) {
    const last = track.clips[track.clips.length - 1];
    if (last) end = Math.max(end, clipEnd(last));
  }
  return end;
}

/** Tempo na fonte para o instante t da timeline: sourceIn + (t − start) × speed. */
export function sourceTimeAt(clip: Clip, t: Us): Us {
  if (clip.kind === "freeze") return clip.sourceIn;
  return clip.sourceIn + Math.round((t - clip.start) * clip.speed);
}

/** Verifica as invariantes de uma trilha: clipes ordenados, sem sobreposição e com tempos inteiros. */
export function trackProblems(track: Track): string[] {
  const problems: string[] = [];
  let prevEnd = -Infinity;
  for (const c of track.clips) {
    if (!Number.isInteger(c.start) || !Number.isInteger(c.duration) || !Number.isInteger(c.sourceIn)) {
      problems.push(`${c.id}: tempo não inteiro`);
    }
    if (c.duration <= 0) problems.push(`${c.id}: duração não positiva`);
    if (c.start < prevEnd) problems.push(`${c.id}: sobrepõe o clipe anterior`);
    prevEnd = clipEnd(c);
  }
  return problems;
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

/** Proporção legível: 1920×1080 → "16:9", 1080×1920 → "9:16", 2560×1080 → "64:27". */
export function aspectLabel(width: number, height: number): string {
  if (width <= 0 || height <= 0) return "—";
  const d = gcd(Math.round(width), Math.round(height));
  return `${Math.round(width) / d}:${Math.round(height) / d}`;
}

/** Os ids pedidos mais todos os clipes do mesmo linkGroup (vídeo e áudio do mesmo arquivo). */
export function withLinked(project: Project, ids: Iterable<Id>): Id[] {
  const wanted = new Set(ids);
  const groups = new Set<Id>();
  for (const t of project.tracks) for (const c of t.clips) if (wanted.has(c.id) && c.linkGroup) groups.add(c.linkGroup);
  const out = new Set(wanted);
  for (const t of project.tracks) for (const c of t.clips) if (c.linkGroup && groups.has(c.linkGroup)) out.add(c.id);
  // Só ids que existem.
  const existing = new Set(project.tracks.flatMap((t) => t.clips.map((c) => c.id)));
  return [...out].filter((id) => existing.has(id));
}

/** Próximo (dir 1) ou anterior (dir −1) ponto de corte (início ou fim de clipe) a partir de t. */
export function nextCut(project: Project, t: Us, dir: 1 | -1): Us | undefined {
  let best: Us | undefined;
  for (const track of project.tracks) {
    for (const c of track.clips) {
      for (const p of [c.start, clipEnd(c)]) {
        if (dir === 1 ? p > t && (best === undefined || p < best) : p < t && (best === undefined || p > best)) best = p;
      }
    }
  }
  return best;
}
