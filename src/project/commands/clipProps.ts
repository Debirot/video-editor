/**
 * Comandos de propriedades de clipe editadas no inspetor.
 * Posição e duração usam moveClips/trimClips (clips.ts); aqui ficam as propriedades simples.
 */
import type { Recipe } from "../history";
import type { Id, Us } from "../types";

export interface AudioPatch {
  gainDb?: number;
  fadeIn?: Us;
  fadeOut?: Us;
}

export const CLIP_GAIN_MIN_DB = -60;
export const CLIP_GAIN_MAX_DB = 12;

/**
 * Muda volume e fades dos clipes de áudio indicados (os outros são ignorados).
 * Fades ficam entre 0 e a duração do clipe e, juntos, não passam da duração
 * (o que foi editado agora tem prioridade; o outro encolhe).
 */
export function setClipAudio(ids: Id[], patch: AudioPatch): Recipe {
  const wanted = new Set(ids);
  return (draft) => {
    for (const track of draft.tracks) {
      if (track.locked || track.kind !== "audio") continue;
      for (const c of track.clips) {
        if (!wanted.has(c.id) || !c.audio) continue;
        if (patch.gainDb !== undefined) {
          c.audio.gainDb = Math.round(Math.min(CLIP_GAIN_MAX_DB, Math.max(CLIP_GAIN_MIN_DB, patch.gainDb)) * 10) / 10;
        }
        const clampFade = (v: Us) => Math.min(c.duration, Math.max(0, Math.round(v)));
        if (patch.fadeIn !== undefined) {
          c.audio.fadeIn = clampFade(patch.fadeIn);
          c.audio.fadeOut = Math.min(c.audio.fadeOut, c.duration - c.audio.fadeIn);
        }
        if (patch.fadeOut !== undefined) {
          c.audio.fadeOut = clampFade(patch.fadeOut);
          c.audio.fadeIn = Math.min(c.audio.fadeIn, c.duration - c.audio.fadeOut);
        }
      }
    }
  };
}
