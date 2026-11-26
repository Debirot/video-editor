/**
 * Desenho da timeline em Canvas 2D: régua, trilhas, clipes e playhead.
 * Só desenha o que está visível. Cores vêm dos tokens (readPalette), nunca fixas.
 * Chamado em requestAnimationFrame por TimelineCanvas.tsx quando algo muda.
 */
import type { Rational, Us } from "@/lib/time";
import type { Overlay } from "./gestures";
import type { Clip, Media, Track } from "@/project/types";
import { RULER_HEIGHT, SEPARATOR_HEIGHT, rulerTicks, timeToX, type TrackLayout, type Viewport } from "./viewport";

export interface Palette {
  bg0: string;
  bg1: string;
  bg2: string;
  border: string;
  text1: string;
  text2: string;
  accent: string;
  clipVideo: string;
  clipAudio: string;
  clipText: string;
  clipImage: string;
  fontSans: string;
}

/** Lê os tokens de src/styles/tokens.css. */
export function readPalette(): Palette {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string) => css.getPropertyValue(name).trim();
  return {
    bg0: v("--bg-0"),
    bg1: v("--bg-1"),
    bg2: v("--bg-2"),
    border: v("--border"),
    text1: v("--text-1"),
    text2: v("--text-2"),
    accent: v("--accent"),
    clipVideo: v("--clip-video"),
    clipAudio: v("--clip-audio"),
    clipText: v("--clip-text"),
    clipImage: v("--clip-image"),
    fontSans: v("--font-sans"),
  };
}

export interface DrawInput {
  ctx: CanvasRenderingContext2D;
  /** Tamanho em px CSS. */
  width: number;
  height: number;
  dpr: number;
  vp: Viewport;
  scrollY: number;
  fps: Rational;
  tracks: Track[];
  layout: TrackLayout;
  playhead: Us;
  /** Clipes selecionados: contorno em accent. */
  selected: Set<string>;
  media: Map<string, Media>;
  /** Pôster pronto da mídia, ou null. */
  posterFor: (media: Media) => CanvasImageSource | null;
  palette: Palette;
  overlay: Overlay;
}

const CLIP_PAD_Y = 3;
const CLIP_RADIUS = 4;

function clipColor(clip: Clip, track: Track, media: Media | undefined, p: Palette): string {
  if (clip.kind === "text" || clip.kind === "shape") return p.clipText;
  if (track.kind === "audio") return p.clipAudio;
  return media?.kind === "image" ? p.clipImage : p.clipVideo;
}

function fileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

function clipLabel(clip: Clip, media: Media | undefined): string {
  if (clip.kind === "text") return clip.text?.content ?? "Texto";
  if (clip.kind === "shape") return "Forma";
  if (!media) return "Mídia ausente";
  return media.missing ? `Ausente: ${fileName(media.path)}` : fileName(media.path);
}

function drawClip(input: DrawInput, track: Track, clip: Clip, rowY: number, rowH: number): void {
  const { ctx, vp, palette: p } = input;
  const x0 = timeToX(clip.start, vp);
  const x1 = timeToX(clip.start + clip.duration, vp);
  if (x1 < 0 || x0 > input.width) return;

  // 1 px de folga em cada ponta separa clipes encostados.
  const x = Math.max(x0 + 0.5, -2);
  const w = Math.min(x1 - 0.5, input.width + 2) - x;
  if (w <= 0.5) return;
  const y = rowY + CLIP_PAD_Y;
  const h = rowH - CLIP_PAD_Y * 2;
  const media = clip.mediaId ? input.media.get(clip.mediaId) : undefined;
  const dimmed = track.hidden || track.muted || !clip.enabled;

  ctx.save();
  ctx.globalAlpha = dimmed ? 0.35 : 1;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, CLIP_RADIUS);
  ctx.fillStyle = clipColor(clip, track, media, p);
  ctx.fill();
  ctx.clip();

  // Fades de áudio: rampa com a área acima escurecida (volume subindo no começo, descendo no fim).
  if (clip.audio && (clip.audio.fadeIn > 0 || clip.audio.fadeOut > 0)) {
    const pxPerUs = input.vp.pxPerSecond / 1_000_000;
    ctx.save();
    ctx.fillStyle = p.bg0;
    ctx.globalAlpha = 0.45;
    if (clip.audio.fadeIn > 0) {
      const fx = x0 + clip.audio.fadeIn * pxPerUs;
      ctx.beginPath();
      ctx.moveTo(x0, y);
      ctx.lineTo(fx, y);
      ctx.lineTo(x0, y + h);
      ctx.closePath();
      ctx.fill();
    }
    if (clip.audio.fadeOut > 0) {
      const fx = x1 - clip.audio.fadeOut * pxPerUs;
      ctx.beginPath();
      ctx.moveTo(x1, y);
      ctx.lineTo(fx, y);
      ctx.lineTo(x1, y + h);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  let textX = x + 6;
  if (track.kind === "video" && media && w > 24) {
    const poster = input.posterFor(media);
    if (poster) {
      const thumbW = Math.round((h * 16) / 9);
      ctx.drawImage(poster, x, y, thumbW, h);
      textX = x + thumbW + 6;
    }
  }
  if ((!media || media.missing) && clip.mediaId) {
    ctx.fillStyle = p.bg0;
    ctx.globalAlpha = 0.4;
    ctx.fillRect(x, y, w, h);
    ctx.globalAlpha = dimmed ? 0.35 : 1;
  }

  // O nome acompanha a borda esquerda da tela quando o começo do clipe sai dela.
  textX = Math.max(textX, 6);
  ctx.fillStyle = p.text1;
  ctx.font = `500 12px ${p.fontSans}`;
  ctx.textBaseline = "middle";
  ctx.fillText(clipLabel(clip, media), textX, y + h / 2);
  ctx.restore();

  // Contorno por cima (fora do clip() para não cortar a borda): sutil, ou accent se selecionado.
  const selected = input.selected.has(clip.id);
  ctx.save();
  ctx.globalAlpha = selected ? 1 : 0.25;
  ctx.strokeStyle = selected ? p.accent : p.text1;
  ctx.lineWidth = selected ? 2 : 1;
  const inset = selected ? 1 : 0.5;
  ctx.beginPath();
  ctx.roundRect(x + inset, y + inset, Math.max(0, w - inset * 2), h - inset * 2, CLIP_RADIUS);
  ctx.stroke();
  ctx.restore();
}

function drawRuler(input: DrawInput): void {
  const { ctx, width, vp, fps, palette: p } = input;
  ctx.fillStyle = p.bg1;
  ctx.fillRect(0, 0, width, RULER_HEIGHT);
  ctx.fillStyle = p.border;
  ctx.fillRect(0, RULER_HEIGHT - 1, width, 1);

  ctx.font = `11px ${p.fontSans}`;
  ctx.textBaseline = "top";
  for (const tick of rulerTicks(vp, fps)) {
    const x = Math.round(tick.x) + 0.5;
    ctx.fillStyle = tick.major ? p.text2 : p.border;
    const len = tick.major ? 10 : 5;
    ctx.fillRect(x - 0.5, RULER_HEIGHT - 1 - len, 1, len);
    if (tick.label) {
      ctx.fillStyle = p.text2;
      ctx.fillText(tick.label, x + 4, 4);
    }
  }
}

function drawPlayhead(input: DrawInput): void {
  const { ctx, vp, playhead, height, palette: p } = input;
  const x = Math.round(timeToX(playhead, vp)) + 0.5;
  if (x < -6 || x > input.width + 6) return;
  ctx.fillStyle = p.accent;
  ctx.fillRect(x - 0.5, 0, 1, height);
  // Alça na régua: retângulo com ponta para baixo.
  ctx.beginPath();
  ctx.moveTo(x - 6, 2);
  ctx.lineTo(x + 6, 2);
  ctx.lineTo(x + 6, 12);
  ctx.lineTo(x, 18);
  ctx.lineTo(x - 6, 12);
  ctx.closePath();
  ctx.fill();
}

export function drawTimeline(input: DrawInput): void {
  const { ctx, width, height, dpr, layout, scrollY, palette: p } = input;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = p.bg0;
  ctx.fillRect(0, 0, width, height);

  const visibleTop = scrollY;
  const visibleBottom = scrollY + height - RULER_HEIGHT;
  const byId = new Map(input.tracks.map((t) => [t.id, t]));

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, RULER_HEIGHT, width, height - RULER_HEIGHT);
  ctx.clip();
  ctx.translate(0, RULER_HEIGHT - scrollY);

  for (const row of layout.rows) {
    if (row.y + row.height < visibleTop || row.y > visibleBottom) continue;
    ctx.fillStyle = p.border;
    ctx.fillRect(0, row.y + row.height - 1, width, 1);
    const track = byId.get(row.trackId);
    if (!track) continue;
    for (const clip of track.clips) drawClip(input, track, clip, row.y, row.height - 1);
  }
  ctx.fillStyle = p.bg1;
  ctx.fillRect(0, layout.separatorY, width, SEPARATOR_HEIGHT);

  // Prévia de mídia arrastada da biblioteca: contorno tracejado onde vai cair.
  for (const ghost of input.overlay.ghosts) {
    const row = layout.rows.find((r) => r.trackId === ghost.trackId);
    if (!row) continue;
    const x0 = timeToX(ghost.start, input.vp);
    const x1 = timeToX(ghost.start + ghost.duration, input.vp);
    ctx.save();
    ctx.setLineDash([5, 4]);
    ctx.strokeStyle = p.accent;
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.9;
    ctx.strokeRect(x0 + 1, row.y + CLIP_PAD_Y + 1, Math.max(2, x1 - x0 - 2), row.height - 1 - CLIP_PAD_Y * 2 - 2);
    ctx.restore();
  }
  ctx.restore();

  // Retângulo de seleção.
  const m = input.overlay.marquee;
  if (m) {
    ctx.save();
    ctx.fillStyle = p.accent;
    ctx.globalAlpha = 0.12;
    const [x, y] = [Math.min(m.x0, m.x1), Math.max(RULER_HEIGHT, Math.min(m.y0, m.y1))];
    const [w, h] = [Math.abs(m.x1 - m.x0), Math.max(m.y0, m.y1) - y];
    ctx.fillRect(x, y, w, h);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = p.accent;
    ctx.lineWidth = 1;
    ctx.strokeRect(Math.round(x) + 0.5, Math.round(y) + 0.5, Math.round(w), Math.round(h));
    ctx.restore();
  }

  drawRuler(input);
  drawPlayhead(input);
}
