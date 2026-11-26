/**
 * Tempo no editor.
 *
 * Regras (docs/DATA_MODEL.md):
 * - Todo tempo do modelo é um inteiro em microssegundos (Us).
 * - FPS é racional ({ num: 30000, den: 1001 } para 29,97).
 * - A duração de um quadro é 1_000_000 × den / num, que nem sempre é inteira.
 *   Por isso nunca guardamos "duração do quadro" como inteiro: convertemos
 *   entre índice de quadro e µs com as funções abaixo, que são exatas na ida e volta.
 */

export type Us = number;

export interface Rational {
  num: number;
  den: number;
}

export const US_PER_SECOND = 1_000_000;

/** Converte segundos (float, vindos de APIs externas) para µs inteiros. */
export function secondsToUs(seconds: number): Us {
  return Math.round(seconds * US_PER_SECOND);
}

/** Converte µs para segundos (float). Só para APIs externas (WebCodecs, Mediabunny, Web Audio). */
export function usToSeconds(us: Us): number {
  return us / US_PER_SECOND;
}

export function fpsToNumber(fps: Rational): number {
  return fps.num / fps.den;
}

/** Instante de início do quadro `frame`, em µs inteiros. */
export function frameToUs(frame: number, fps: Rational): Us {
  return Math.round((frame * fps.den * US_PER_SECOND) / fps.num);
}

/**
 * Índice do quadro que contém o instante `t`.
 * Soma 0,5 µs antes de dividir para compensar o arredondamento de frameToUs,
 * garantindo usToFrame(frameToUs(n)) === n para qualquer FPS abaixo de 1 MHz.
 */
export function usToFrame(t: Us, fps: Rational): number {
  return Math.floor(((t + 0.5) * fps.num) / (fps.den * US_PER_SECOND));
}

/** Arredonda `t` ao início de quadro mais próximo. */
export function snapToFrame(t: Us, fps: Rational): Us {
  const exact = (t * fps.num) / (fps.den * US_PER_SECOND);
  return frameToUs(Math.round(exact), fps);
}

/** Duração de `frames` quadros, em µs inteiros (exata para somas de quadros inteiros). */
export function framesToDuration(frames: number, fps: Rational): Us {
  return frameToUs(frames, fps);
}

/** FPS nominal usado no timecode (29,97 → 30, 23,976 → 24). */
export function nominalFps(fps: Rational): number {
  return Math.round(fps.num / fps.den);
}

/**
 * Timecode HH:MM:SS:FF sem drop-frame.
 * Em 29,97 o timecode sem drop-frame se afasta do relógio em cerca de 3,6 s por hora;
 * drop-frame fica para depois (docs/DECISIONS.md).
 */
export function formatTimecode(t: Us, fps: Rational): string {
  const nominal = nominalFps(fps);
  const totalFrames = Math.max(0, usToFrame(t, fps));
  const ff = totalFrames % nominal;
  const totalSeconds = Math.floor(totalFrames / nominal);
  const ss = totalSeconds % 60;
  const mm = Math.floor(totalSeconds / 60) % 60;
  const hh = Math.floor(totalSeconds / 3600);
  return [hh, mm, ss, ff].map((n) => String(n).padStart(2, "0")).join(":");
}

/**
 * Lê "HH:MM:SS:FF" (ou formas curtas como "SS:FF" e "MM:SS:FF") e devolve µs
 * no início do quadro. Devolve null se o texto for inválido.
 */
export function parseTimecode(text: string, fps: Rational): Us | null {
  const parts = text.trim().split(/[:;.]/);
  if (parts.length < 1 || parts.length > 4) return null;
  if (!parts.every((p) => /^\d+$/.test(p))) return null;
  const nums = parts.map(Number);
  while (nums.length < 4) nums.unshift(0);
  const [hh, mm, ss, ff] = nums as [number, number, number, number];
  const nominal = nominalFps(fps);
  if (mm >= 60 || ss >= 60 || ff >= nominal) return null;
  const frames = ((hh * 60 + mm) * 60 + ss) * nominal + ff;
  return frameToUs(frames, fps);
}
