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
