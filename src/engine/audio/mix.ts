/**
 * Mixagem de áudio para a exportação (no Worker, onde não existe Web Audio):
 * reamostra cada trecho para 48 kHz estéreo por interpolação linear, aplica ganho e
 * fades (envelope.ts, a mesma regra do preview) e soma no buffer de saída.
 */
import type { Us } from "@/lib/time";
import type { PcmChunk } from "../messages";
import { fadeFactor } from "./envelope";

export const MIX_RATE = 48_000;
export const MIX_CHANNELS = 2;

/** Índice da amostra de saída (48 kHz) no instante t. */
export function sampleIndex(t: Us): number {
  return Math.round((t * MIX_RATE) / 1_000_000);
}

/** Buffer de silêncio para [from, to): MIX_CHANNELS canais planares. */
export function silence(from: Us, to: Us): Float32Array[] {
  const length = Math.max(0, sampleIndex(to) - sampleIndex(from));
  return Array.from({ length: MIX_CHANNELS }, () => new Float32Array(length));
}

/**
 * Soma `chunk` em `out`, cuja primeira amostra corresponde ao instante `outStart`.
 * Mono vai para os dois canais. A velocidade do clipe lê a fonte mais rápido (o tom muda,
 * como no preview).
 */
export function mixInto(out: Float32Array[], outStart: Us, chunk: PcmChunk): void {
  const length = out[0]?.length ?? 0;
  const base = sampleIndex(outStart);
  const i0 = Math.max(0, sampleIndex(chunk.start) - base);
  const i1 = Math.min(length, sampleIndex(chunk.end) - base);
  const src = chunk.channels;
  const srcLen = src[0]!.length;
  const step = (chunk.sampleRate * chunk.speed) / MIX_RATE;
  const startIndex = sampleIndex(chunk.start);

  for (let i = i0; i < i1; i++) {
    const pos = (base + i - startIndex) * step;
    const k = Math.floor(pos);
    if (k >= srcLen) break;
    const frac = pos - k;
    const t = ((base + i) * 1_000_000) / MIX_RATE;
    const g = chunk.gain * fadeFactor(t, chunk);
    if (g === 0) continue;
    for (let c = 0; c < out.length; c++) {
      const ch = src[Math.min(c, src.length - 1)]!;
      const a = ch[k]!;
      const b = k + 1 < srcLen ? ch[k + 1]! : a;
      out[c]![i]! += (a + (b - a) * frac) * g;
    }
  }
}

/** Corta picos acima de ±1 (soma de várias trilhas altas) antes de codificar. */
export function clampInPlace(out: Float32Array[]): void {
  for (const ch of out) for (let i = 0; i < ch.length; i++) ch[i] = Math.max(-1, Math.min(1, ch[i]!));
}
