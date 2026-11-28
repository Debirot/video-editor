/**
 * Comandos de propriedades de clipe editadas no inspetor.
 * Posição e duração usam moveClips/trimClips (clips.ts); aqui ficam as propriedades simples.
 */
import type { Draft } from "immer";
import type { Recipe } from "../history";
import { DEFAULT_CROP, DEFAULT_TRANSFORM } from "../normalize";
import type { Crop, Id, Project, Transform, Us } from "../types";

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

export const SCALE_MIN = 0.01;
export const SCALE_MAX = 10;
/** Quanto sobra no mínimo de cada eixo depois do recorte. */
const CROP_MIN_VISIBLE = 0.01;

export type TransformPatch = Partial<Transform>;
export type CropPatch = Partial<Crop>;

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/** Clipes de trilhas de vídeo destravadas que estão em `ids`. */
function* videoClips(draft: Draft<Project>, ids: Id[]) {
  const wanted = new Set(ids);
  for (const track of draft.tracks) {
    if (track.locked || track.kind !== "video") continue;
    for (const c of track.clips) if (wanted.has(c.id)) yield c;
  }
}

/**
 * Muda posição (px do projeto), escala (1 = encaixado), rotação (graus) e opacidade (0..1)
 * dos clipes de vídeo indicados. Valores fora do intervalo são limitados.
 */
export function setClipTransform(ids: Id[], patch: TransformPatch): Recipe {
  return (draft) => {
    for (const c of videoClips(draft, ids)) {
      const t = c.transform;
      if (patch.x !== undefined) t.x = Math.round(patch.x * 10) / 10;
      if (patch.y !== undefined) t.y = Math.round(patch.y * 10) / 10;
      if (patch.scale !== undefined) t.scale = Math.round(clamp(patch.scale, SCALE_MIN, SCALE_MAX) * 1000) / 1000;
      if (patch.rotation !== undefined) t.rotation = Math.round(clamp(patch.rotation, -3600, 3600) * 10) / 10;
      if (patch.opacity !== undefined) t.opacity = Math.round(clamp(patch.opacity, 0, 1) * 1000) / 1000;
    }
  };
}

/**
 * Muda o recorte (frações de 0 a 1 de cada lado). O lado editado tem prioridade:
 * se esquerda + direita (ou cima + baixo) passarem do total, o lado oposto encolhe.
 */
export function setClipCrop(ids: Id[], patch: CropPatch): Recipe {
  const max = 1 - CROP_MIN_VISIBLE;
  return (draft) => {
    for (const c of videoClips(draft, ids)) {
      const k = c.crop;
      const set = (side: keyof Crop, opposite: keyof Crop, v: number) => {
        k[side] = Math.round(clamp(v, 0, max) * 1000) / 1000;
        k[opposite] = Math.min(k[opposite], Math.round((max - k[side]) * 1000) / 1000);
      };
      if (patch.left !== undefined) set("left", "right", patch.left);
      if (patch.right !== undefined) set("right", "left", patch.right);
      if (patch.top !== undefined) set("top", "bottom", patch.top);
      if (patch.bottom !== undefined) set("bottom", "top", patch.bottom);
    }
  };
}

/** Volta posição, escala, rotação, opacidade e recorte ao padrão. */
export function resetClipTransform(ids: Id[]): Recipe {
  return (draft) => {
    for (const c of videoClips(draft, ids)) {
      c.transform = { ...DEFAULT_TRANSFORM };
      c.crop = { ...DEFAULT_CROP };
    }
  };
}
