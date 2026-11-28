/**
 * Posicionamento de uma camada no quadro: encaixe (contain), rotação gravada no arquivo
 * (vídeo de celular em pé), transformação do clipe (posição, escala, rotação) e recorte.
 * Funções puras, usadas pelo compositor (preview e exportação) e pelas alças do preview.
 *
 * Convenções: x/y do clipe em pixels do projeto, a partir do centro; rotação em graus,
 * positiva no sentido horário; recorte em frações (0..1) de cada lado da imagem original,
 * que escondem a área sem mover o resto.
 */
import type { Crop, Transform } from "@/project/types";

export interface Size {
  width: number;
  height: number;
}

export interface Placement {
  /** Centro da imagem inteira (sem recorte), em px do destino. */
  cx: number;
  cy: number;
  /** Tamanho da imagem inteira, antes de girar, em px do destino. */
  w: number;
  h: number;
  /** Ângulo total em radianos (rotação do arquivo + rotação do clipe). */
  angle: number;
  /** Parte visível da imagem em coordenadas de textura: u0, v0, u1, v1. */
  uv: [number, number, number, number];
}

const MIN_VISIBLE = 0.01;

/**
 * `src.natural`: a fonte tem tamanho próprio em px do projeto (formas, textos) e escala 1
 * é esse tamanho; sem ele, escala 1 = a imagem inteira cabendo na saída (contain).
 */
export function placeLayer(
  src: Size & { rotation?: number; natural?: boolean },
  out: Size,
  project: Size,
  t: Transform,
  crop: Crop,
): Placement {
  const fileRotation = ((src.rotation ?? 0) % 360 + 360) % 360;
  const swap = fileRotation % 180 !== 0;
  const shownW = swap ? src.height : src.width;
  const shownH = swap ? src.width : src.height;
  const k = out.width / project.width;
  const fit = (src.natural ? k : Math.min(out.width / shownW, out.height / shownH)) * t.scale;
  const u0 = Math.max(0, crop.left);
  const v0 = Math.max(0, crop.top);
  let u1 = Math.min(1, 1 - crop.right);
  let v1 = Math.min(1, 1 - crop.bottom);
  if (u1 - u0 < MIN_VISIBLE) u1 = u0 + MIN_VISIBLE;
  if (v1 - v0 < MIN_VISIBLE) v1 = v0 + MIN_VISIBLE;
  return {
    cx: out.width / 2 + t.x * k,
    cy: out.height / 2 + t.y * k,
    w: src.width * fit,
    h: src.height * fit,
    angle: ((fileRotation + t.rotation) * Math.PI) / 180,
    uv: [u0, v0, u1, v1],
  };
}

/** Ponto da imagem (u, v em 0..1) → px do destino. */
export function toScreen(p: Placement, u: number, v: number): [number, number] {
  const dx = (u - 0.5) * p.w;
  const dy = (v - 0.5) * p.h;
  const c = Math.cos(p.angle);
  const s = Math.sin(p.angle);
  return [p.cx + dx * c - dy * s, p.cy + dx * s + dy * c];
}

/** px do destino → ponto da imagem (u, v); fora de 0..1 = fora da imagem. */
export function toImage(p: Placement, x: number, y: number): [number, number] {
  const dx = x - p.cx;
  const dy = y - p.cy;
  const c = Math.cos(p.angle);
  const s = Math.sin(p.angle);
  return [(dx * c + dy * s) / p.w + 0.5, (-dx * s + dy * c) / p.h + 0.5];
}

/** Cantos da parte visível (com recorte): superior esquerdo, superior direito, inferior direito, inferior esquerdo. */
export function visibleCorners(p: Placement): [number, number][] {
  const [u0, v0, u1, v1] = p.uv;
  return [toScreen(p, u0, v0), toScreen(p, u1, v0), toScreen(p, u1, v1), toScreen(p, u0, v1)];
}

export function containsPoint(p: Placement, x: number, y: number): boolean {
  const [u, v] = toImage(p, x, y);
  const [u0, v0, u1, v1] = p.uv;
  return u >= u0 && u <= u1 && v >= v0 && v <= v1;
}

/**
 * Matriz 3×3 (colunas, como o WebGL espera) que leva (u, v, 1) a px do destino.
 * px = centro + R·((u − 0,5)·w, (v − 0,5)·h)
 */
export function placementMatrix(p: Placement): Float32Array {
  const c = Math.cos(p.angle);
  const s = Math.sin(p.angle);
  const ux = p.w * c;
  const uy = p.w * s;
  const vx = -p.h * s;
  const vy = p.h * c;
  const ex = p.cx - 0.5 * (ux + vx);
  const ey = p.cy - 0.5 * (uy + vy);
  return new Float32Array([ux, uy, 0, vx, vy, 0, ex, ey, 1]);
}
