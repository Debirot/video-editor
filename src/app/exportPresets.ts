/**
 * Opções do diálogo de exportação: resoluções na proporção do projeto, FPS e taxa de bits.
 * Funções puras (testadas em exportPresets.test.ts).
 */
import { fpsToNumber, type Rational } from "@/lib/time";

export type Quality = "alta" | "media" | "baixa";

export interface Resolution {
  width: number;
  height: number;
  label: string;
}

const SHORT_SIDES = [2160, 1440, 1080, 720, 480];

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

/** Resoluções na proporção do projeto (lado menor 2160…480), mais a do projeto. Maior primeiro. */
export function resolutionOptions(width: number, height: number): Resolution[] {
  const short = Math.min(width, height);
  const out = new Map<string, Resolution>();
  const add = (w: number, h: number, label: string) => {
    const key = `${w}x${h}`;
    if (!out.has(key)) out.set(key, { width: w, height: h, label });
  };
  add(width, height, `${width}×${height} (do projeto)`);
  for (const s of SHORT_SIDES) {
    const scale = s / short;
    const w = even(width * scale);
    const h = even(height * scale);
    add(w, h, `${w}×${h}${s === 2160 ? " (4K)" : ` (${s}p)`}`);
  }
  return [...out.values()].sort((a, b) => b.width * b.height - a.width * a.height);
}

export interface FpsOption {
  fps: Rational;
  label: string;
}

const COMMON_FPS: Rational[] = [
  { num: 24, den: 1 },
  { num: 25, den: 1 },
  { num: 30, den: 1 },
  { num: 50, den: 1 },
  { num: 60, den: 1 },
];

function fpsLabel(fps: Rational): string {
  const n = fpsToNumber(fps);
  return Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/0+$/, "").replace(".", ",");
}

/** FPS do projeto primeiro, depois os comuns que forem diferentes. */
export function fpsOptions(project: Rational): FpsOption[] {
  const same = (a: Rational, b: Rational) => a.num * b.den === b.num * a.den;
  return [
    { fps: project, label: `${fpsLabel(project)} (do projeto)` },
    ...COMMON_FPS.filter((f) => !same(f, project)).map((fps) => ({ fps, label: fpsLabel(fps) })),
  ];
}

/** Bits por pixel por quadro de cada qualidade (H.264); H.265 precisa de ~35% menos. */
const BPP: Record<Quality, number> = { alta: 0.15, media: 0.09, baixa: 0.05 };

export function bitrateFor(width: number, height: number, fps: Rational, quality: Quality, codec: "avc" | "hevc"): number {
  const raw = width * height * fpsToNumber(fps) * BPP[quality] * (codec === "hevc" ? 0.65 : 1);
  return Math.max(1_000_000, Math.round(raw / 100_000) * 100_000);
}

/** Tamanho aproximado do arquivo em bytes (vídeo + áudio AAC de 192 kb/s). */
export function estimateBytes(videoBitrate: number, withAudio: boolean, durationUs: number): number {
  return Math.round(((videoBitrate + (withAudio ? 192_000 : 0)) * (durationUs / 1_000_000)) / 8);
}
