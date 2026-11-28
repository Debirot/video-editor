/**
 * Formas (retângulo, elipse, linha): colocar na timeline e editar o estilo.
 * Uma forma é um clipe `kind: "shape"` numa trilha de vídeo, sem mídia; posição, escala,
 * rotação e opacidade vêm do `transform`, como nos outros clipes (T2.02).
 */
import { frameToUs, snapToFrame, type Rational } from "@/lib/time";
import type { Recipe } from "../history";
import { DEFAULT_SHAPES } from "../normalize";
import { clipEnd } from "../queries";
import type { Id, ShapeStyle, ShapeType, Track, Us } from "../types";
import { createClip, insertClip } from "./clips";
import { addTrack } from "./tracks";

/** Nome de cada tipo na interface. */
export const SHAPE_NAMES: Record<ShapeType, string> = { rect: "Retângulo", ellipse: "Elipse", line: "Linha" };

/** Duração de uma forma nova, em segundos. */
export const SHAPE_DURATION_SECONDS = 5;
/** Maior largura/altura de uma forma, em px do projeto. */
export const SHAPE_SIZE_MAX = 8192;
export const SHAPE_STROKE_MAX = 500;

function isFree(track: Track, from: Us, to: Us): boolean {
  return track.clips.every((c) => clipEnd(c) <= from || c.start >= to);
}

/**
 * Põe uma forma em `at` (no quadro), por 5 s, na trilha de vídeo mais alta que esteja
 * destravada e livre nesse trecho; sem nenhuma, cria uma trilha de vídeo acima das outras.
 * Nunca sobrescreve outro clipe. `id` vem de fora (refazer reaplica os mesmos patches).
 */
export function addShapeClip(type: ShapeType, at: Us, fps: Rational, id: Id): Recipe {
  return (draft) => {
    const start = snapToFrame(Math.max(0, at), fps);
    const duration = frameToUs(SHAPE_DURATION_SECONDS * Math.round(fps.num / fps.den), fps);
    const end = start + duration;
    const free = (t: Track) => t.kind === "video" && !t.locked && isFree(t, start, end);
    let track = [...draft.tracks].reverse().find((t) => free(t as Track));
    if (!track) {
      addTrack("video")(draft);
      track = [...draft.tracks].reverse().find((t) => t.kind === "video")!;
    }
    insertClip(track as Track, createClip({ id, kind: "shape", start, duration, shape: { ...DEFAULT_SHAPES[type] } }));
  };
}

export type ShapePatch = Partial<ShapeStyle>;

const HEX = /^#[0-9a-f]{6}$/i;

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/**
 * Muda o estilo das formas indicadas (outros clipes e trilhas travadas são ignorados).
 * Tamanhos em px inteiros (1 a 8192); espessura 0 a 500 (0 = sem contorno); raio até
 * metade do menor lado; cores só "#rrggbb" (o preenchimento aceita "none").
 */
export function setClipShape(ids: Id[], patch: ShapePatch): Recipe {
  const wanted = new Set(ids);
  return (draft) => {
    for (const track of draft.tracks) {
      if (track.locked || track.kind !== "video") continue;
      for (const c of track.clips) {
        if (!wanted.has(c.id) || c.kind !== "shape" || !c.shape) continue;
        const s = c.shape;
        if (patch.type !== undefined && patch.type !== s.type && patch.type in DEFAULT_SHAPES) {
          s.type = patch.type;
          // Uma linha é feita só de contorno: sem ele, ela sumiria.
          if (s.type === "line" && s.strokeWidth <= 0) {
            s.strokeWidth = DEFAULT_SHAPES.line.strokeWidth;
            s.stroke = DEFAULT_SHAPES.line.stroke;
          }
        }
        if (patch.width !== undefined) s.width = Math.round(clamp(patch.width, 1, SHAPE_SIZE_MAX));
        if (patch.height !== undefined) s.height = Math.round(clamp(patch.height, 1, SHAPE_SIZE_MAX));
        if (patch.strokeWidth !== undefined) s.strokeWidth = Math.round(clamp(patch.strokeWidth, 0, SHAPE_STROKE_MAX) * 10) / 10;
        if (patch.fill !== undefined && (patch.fill === "none" || HEX.test(patch.fill))) s.fill = patch.fill.toLowerCase();
        if (patch.stroke !== undefined && HEX.test(patch.stroke)) s.stroke = patch.stroke.toLowerCase();
        if (patch.radius !== undefined) s.radius = Math.round(Math.max(0, patch.radius));
        s.radius = Math.min(s.radius, Math.floor(Math.min(s.width, s.height) / 2));
      }
    }
  };
}
