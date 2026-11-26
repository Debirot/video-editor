/**
 * Modelo de dados do projeto. Fonte da verdade: docs/DATA_MODEL.md.
 * Mudanças aqui exigem atualizar o documento e normalize.ts no mesmo commit.
 */
import type { Rational, Us } from "@/lib/time";

export type { Rational, Us };

/** nanoid curto com prefixo de tipo, ex.: "c_7fK2xQ9a". */
export type Id = string;

export const CURRENT_SCHEMA_VERSION = 1;

export interface ProjectSettings {
  width: number;
  height: number;
  fps: Rational;
  sampleRate: 48000;
  background: string;
}

export interface Bin {
  id: Id;
  name: string;
  parentId: Id | null;
}

export interface Marker {
  id: Id;
  time: Us;
  name: string;
  color: string;
}

export interface Project {
  schemaVersion: typeof CURRENT_SCHEMA_VERSION;
  id: Id;
  name: string;
  settings: ProjectSettings;
  bins: Bin[];
  media: Media[];
  tracks: Track[];
  markers: Marker[];
}

export type MediaKind = "video" | "audio" | "image";

export type ProxyStatus = "none" | "queued" | "running" | "ready" | "failed";

export interface MediaProbe {
  duration: Us;
  width?: number;
  height?: number;
  fps?: Rational;
  variableFrameRate?: boolean;
  videoCodec?: string;
  audioCodec?: string;
  sampleRate?: number;
  channels?: number;
  rotation?: 0 | 90 | 180 | 270;
}

export interface Media {
  id: Id;
  kind: MediaKind;
  /** Caminho absoluto do original. */
  path: string;
  /** Relativo à pasta do projeto, usado para religar. */
  relPath: string | null;
  fingerprint: { size: number; mtime: number; partialHash: string };
  probe: MediaProbe;
  proxy: { status: ProxyStatus; path?: string };
  binId: Id | null;
  /** Calculado ao abrir, não é gravado. */
  missing?: boolean;
}

export type TrackKind = "video" | "audio" | "subtitle";

export interface Track {
  id: Id;
  kind: TrackKind;
  name: string;
  hidden: boolean;
  muted: boolean;
  locked: boolean;
  solo: boolean;
  gainDb: number;
  /** Ordenados por start, sem sobreposição. */
  clips: Clip[];
  transitions: Transition[];
}

export type ClipKind = "media" | "freeze" | "text" | "shape" | "subtitle";

export interface Transform {
  x: number;
  y: number;
  scale: number;
  rotation: number;
  opacity: number;
}

/** Frações de 0 a 1. */
export interface Crop {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface ColorAdjust {
  exposure: number;
  brightness: number;
  contrast: number;
  saturation: number;
  temperature: number;
}

export interface ClipAudio {
  gainDb: number;
  fadeIn: Us;
  fadeOut: Us;
}

export interface TextStyle {
  font: string;
  size: number;
  weight: number;
  color: string;
  align: "left" | "center" | "right";
  outline?: { color: string; width: number };
  shadow?: { color: string; blur: number; x: number; y: number };
  background?: { color: string; padding: number; radius: number };
}

export interface ShapeStyle {
  type: "rect" | "ellipse" | "line";
  fill: string;
  stroke: string;
  strokeWidth: number;
  radius: number;
}

export interface Clip {
  id: Id;
  kind: ClipKind;
  /** media e freeze. */
  mediaId?: Id;
  /** Posição na timeline. */
  start: Us;
  /** Duração na timeline. */
  duration: Us;
  /** Ponto de entrada na fonte (no freeze, o quadro congelado). */
  sourceIn: Us;
  /** 1 = normal, 0.5 = câmera lenta, 2 = acelerado. */
  speed: number;
  /** Liga vídeo e áudio do mesmo arquivo. */
  linkGroup?: Id;
  enabled: boolean;
  transform: Transform;
  crop: Crop;
  color: ColorAdjust;
  effects: Effect[];
  audio?: ClipAudio;
  text?: TextStyle & { content: string };
  shape?: ShapeStyle;
  /** Chave = caminho da propriedade, ex.: "transform.x" ou "effects.e_1.radius". */
  keyframes: Record<string, Keyframe[]>;
}

export type EffectType = "blur" | "sharpen" | "lut" | "vignette";

export interface Effect {
  id: Id;
  type: EffectType;
  enabled: boolean;
  /** Ex.: { radius: 8 } ou { file: "luts/filme.cube", amount: 0.8 }. */
  params: Record<string, number | string>;
}

export type TransitionType = "dissolve" | "fadeBlack" | "slide" | "zoom";

export interface Transition {
  id: Id;
  type: TransitionType;
  fromClipId: Id;
  toClipId: Id;
  /** Centrada no corte entre os dois clipes. */
  duration: Us;
  params?: Record<string, number | string>;
}

export type Ease = "linear" | "smooth" | "hold";

export interface Keyframe {
  /** Relativo ao início do clipe. */
  t: Us;
  v: number;
  ease: Ease;
}
