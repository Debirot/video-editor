/**
 * Geometria da timeline: tempo ↔ pixel, zoom, rolagem, linhas das trilhas e marcas da régua.
 * Funções puras (sem DOM), testadas em viewport.test.ts. O desenho fica em draw.ts.
 */
import { formatTimecode, frameToUs, nominalFps, usToFrame, type Rational, type Us } from "@/lib/time";
import type { Track } from "@/project/types";

export const RULER_HEIGHT = 24;
export const TRACK_HEIGHT = 44;
export const SEPARATOR_HEIGHT = 4;

/** Limites de zoom em pixels por segundo. 2 px/s ≈ 1 h em 7.200 px; 4.000 px/s ≈ 130 px por quadro a 30 qps. */
export const MIN_PX_PER_SECOND = 2;
export const MAX_PX_PER_SECOND = 4000;
export const DEFAULT_PX_PER_SECOND = 40;

/** Espaço mínimo entre marcas principais da régua. */
const MIN_MAJOR_SPACING_PX = 80;

export interface Viewport {
  pxPerSecond: number;
  /** Deslocamento horizontal em px: x = 0 na tela mostra o tempo scrollX / pxPerSecond. */
  scrollX: number;
  /** Largura visível da área das trilhas, em px. */
  width: number;
}

export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

export function timeToX(t: Us, vp: Viewport): number {
  return (t * vp.pxPerSecond) / 1_000_000 - vp.scrollX;
}

/** Tempo (µs inteiros, nunca negativo) sob o pixel x. */
export function xToTime(x: number, vp: Viewport): Us {
  return Math.max(0, Math.round(((x + vp.scrollX) * 1_000_000) / vp.pxPerSecond));
}

/** Maior rolagem horizontal: o fim do conteúdo pode chegar até a metade da tela. */
export function maxScrollX(contentEnd: Us, vp: Viewport): number {
  return Math.max(0, (contentEnd * vp.pxPerSecond) / 1_000_000 - vp.width / 2);
}

export function clampScrollX(scrollX: number, contentEnd: Us, vp: Viewport): number {
  return clamp(scrollX, 0, maxScrollX(contentEnd, vp));
}

/**
 * Zoom mantendo fixo o tempo sob `anchorX` (cursor ou playhead).
 * Devolve o novo pxPerSecond e o novo scrollX (nunca negativo).
 */
export function zoomAt(vp: Viewport, factor: number, anchorX: number): { pxPerSecond: number; scrollX: number } {
  const pxPerSecond = clamp(vp.pxPerSecond * factor, MIN_PX_PER_SECOND, MAX_PX_PER_SECOND);
  const anchorSeconds = (anchorX + vp.scrollX) / vp.pxPerSecond;
  return { pxPerSecond, scrollX: Math.max(0, anchorSeconds * pxPerSecond - anchorX) };
}

/** Zoom que mostra de 0 até `contentEnd` (com 10% de folga) na largura disponível. */
export function fitZoom(contentEnd: Us, width: number): number {
  if (contentEnd <= 0 || width <= 0) return DEFAULT_PX_PER_SECOND;
  return clamp((width * 0.9 * 1_000_000) / contentEnd, MIN_PX_PER_SECOND, MAX_PX_PER_SECOND);
}

export interface TrackRow {
  trackId: string;
  kind: Track["kind"];
  /** Topo da linha, abaixo da régua, sem descontar a rolagem vertical. */
  y: number;
  height: number;
}

export interface TrackLayout {
  rows: TrackRow[];
  /** Faixa entre vídeo e áudio. */
  separatorY: number;
  /** Altura total das linhas (sem a régua). */
  height: number;
}

/**
 * Vídeo em cima (o índice maior fica no topo, como na composição), áudio embaixo.
 * Os cabeçalhos em DOM (TimelinePanel) usam as mesmas alturas.
 */
export function trackLayout(tracks: Track[]): TrackLayout {
  const video = tracks.filter((t) => t.kind === "video").reverse();
  const others = tracks.filter((t) => t.kind !== "video");
  const rows: TrackRow[] = [];
  let y = 0;
  for (const t of video) {
    rows.push({ trackId: t.id, kind: t.kind, y, height: TRACK_HEIGHT });
    y += TRACK_HEIGHT;
  }
  const separatorY = y;
  y += SEPARATOR_HEIGHT;
  for (const t of others) {
    rows.push({ trackId: t.id, kind: t.kind, y, height: TRACK_HEIGHT });
    y += TRACK_HEIGHT;
  }
  return { rows, separatorY, height: y };
}

/** Intervalos candidatos da régua: em quadros abaixo de 1 s, em segundos a partir daí. */
type Interval = { frames: number } | { seconds: number };

const INTERVALS: Interval[] = [
  { frames: 1 },
  { frames: 2 },
  { frames: 5 },
  { frames: 10 },
  { seconds: 1 },
  { seconds: 2 },
  { seconds: 5 },
  { seconds: 10 },
  { seconds: 15 },
  { seconds: 30 },
  { seconds: 60 },
  { seconds: 120 },
  { seconds: 300 },
  { seconds: 600 },
  { seconds: 900 },
  { seconds: 1800 },
  { seconds: 3600 },
];

function intervalSeconds(i: Interval, fps: Rational): number {
  return "frames" in i ? (i.frames * fps.den) / fps.num : i.seconds;
}

export interface RulerTick {
  t: Us;
  x: number;
  major: boolean;
  label?: string;
}

/** Rótulo curto: "1:05" (m:ss), "1:02:05" com horas, "1:05:12" (m:ss:ff) com quadros. */
export function rulerLabel(t: Us, fps: Rational, withFrames: boolean): string {
  const [hh, mm, ss, ff] = formatTimecode(t, fps).split(":") as [string, string, string, string];
  const h = Number(hh);
  const base = h > 0 ? `${h}:${mm}:${ss}` : `${Number(mm)}:${ss}`;
  return withFrames ? `${base}:${ff}` : base;
}

/**
 * Marcas visíveis da régua. O intervalo principal é o menor que deixa pelo menos
 * 80 px entre rótulos; cada intervalo principal tem marcas menores entre si.
 */
export function rulerTicks(vp: Viewport, fps: Rational): RulerTick[] {
  // Quadros a mais que o FPS nominal (ex.: 15 quadros a 10 qps) não fazem sentido; pula para segundos.
  const nominal = nominalFps(fps);
  const candidates = INTERVALS.filter((i) => !("frames" in i) || i.frames < nominal);
  const major =
    candidates.find((i) => intervalSeconds(i, fps) * vp.pxPerSecond >= MIN_MAJOR_SPACING_PX) ??
    candidates[candidates.length - 1]!;
  const withFrames = "frames" in major;
  const subdivisions = "frames" in major ? Math.min(major.frames, 5) : major.seconds === 15 ? 3 : major.seconds % 5 === 0 || major.seconds === 1 ? 5 : 2;

  const ticks: RulerTick[] = [];
  const startT = xToTime(0, vp);
  const endT = xToTime(vp.width, vp);

  if ("frames" in major) {
    const step = major.frames / subdivisions; // em quadros (inteiro, já que subdivisions divide ou é 1..5)
    const minorFrames = Number.isInteger(step) ? step : 1;
    const first = Math.floor(usToFrame(startT, fps) / minorFrames) * minorFrames;
    const last = usToFrame(endT, fps) + minorFrames;
    for (let f = first; f <= last; f += minorFrames) {
      const t = frameToUs(f, fps);
      const isMajor = f % major.frames === 0;
      ticks.push({ t, x: timeToX(t, vp), major: isMajor, label: isMajor ? rulerLabel(t, fps, true) : undefined });
    }
  } else {
    const minorUs = (major.seconds * 1_000_000) / subdivisions;
    const first = Math.floor(startT / minorUs);
    const last = Math.ceil(endT / minorUs);
    for (let i = first; i <= last; i++) {
      const t = Math.round(i * minorUs);
      const isMajor = i % subdivisions === 0;
      ticks.push({ t, x: timeToX(t, vp), major: isMajor, label: isMajor ? rulerLabel(t, fps, withFrames) : undefined });
    }
  }
  return ticks;
}
