/**
 * Envelope de volume de um clipe de áudio (fades de entrada e saída). Usado pelo preview
 * (rampas do Web Audio, src/app/audio.ts) e pela exportação (mix.ts): a mesma regra nos dois.
 */
import type { Us } from "@/lib/time";

export interface FadeShape {
  clipStart: Us;
  clipEnd: Us;
  fadeIn: Us;
  fadeOut: Us;
}

/** Fator de fade (0..1) no instante t da timeline. */
export function fadeFactor(t: Us, c: FadeShape): number {
  let f = 1;
  if (c.fadeIn > 0 && t < c.clipStart + c.fadeIn) f = Math.min(f, Math.max(0, (t - c.clipStart) / c.fadeIn));
  if (c.fadeOut > 0 && t > c.clipEnd - c.fadeOut) f = Math.min(f, Math.max(0, (c.clipEnd - t) / c.fadeOut));
  return f;
}

/** Pontos (tempo na timeline) onde o envelope muda de inclinação dentro de [start, end]. */
export function envelopePoints(c: FadeShape & { start: Us; end: Us }): Us[] {
  const pts = new Set<Us>([c.start, c.end]);
  for (const p of [c.clipStart + c.fadeIn, c.clipEnd - c.fadeOut]) if (p > c.start && p < c.end) pts.add(p);
  return [...pts].sort((a, b) => a - b);
}
