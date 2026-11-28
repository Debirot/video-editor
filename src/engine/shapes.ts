/**
 * Formas (retângulo, elipse, linha) desenhadas em Canvas 2D no Worker e entregues ao
 * compositor como textura. A forma é redesenhada no tamanho em que vai aparecer
 * (escala do clipe × tamanho da saída), então fica nítida no preview e na exportação.
 * Os desenhos ficam num cache pequeno: parado ou exportando, a mesma forma não é refeita.
 */
import type { ShapeStyle } from "@/project/types";
import type { Size } from "./transform";

/** Maior lado do desenho, em px (limite de textura seguro em GPUs integradas). */
export const MAX_RASTER = 4096;
const CACHE_SIZE = 16;

/** Tamanho próprio da forma em px do projeto (placeLayer com `natural`). */
export function shapeSize(s: ShapeStyle): Size & { natural: true } {
  if (s.type === "line") return { width: s.width, height: Math.max(1, s.strokeWidth), natural: true };
  return { width: s.width, height: s.height, natural: true };
}

/**
 * Tamanho do desenho para uma forma de `size` px do projeto mostrada com escala
 * `outScale` (saída ÷ projeto) × `scale` (do clipe). `ratio` = px do desenho por px do projeto.
 */
export function rasterSize(size: Size, outScale: number, scale: number): Size & { ratio: number } {
  let ratio = outScale * scale;
  const longest = Math.max(size.width, size.height) * ratio;
  if (longest > MAX_RASTER) ratio *= MAX_RASTER / longest;
  return {
    width: Math.max(1, Math.min(MAX_RASTER, Math.round(size.width * ratio))),
    height: Math.max(1, Math.min(MAX_RASTER, Math.round(size.height * ratio))),
    ratio,
  };
}

function draw(ctx: OffscreenCanvasRenderingContext2D, s: ShapeStyle, size: Size): void {
  const { width: w, height: h } = size;
  if (s.type === "line") {
    ctx.fillStyle = s.stroke;
    ctx.fillRect(0, 0, w, h);
    return;
  }
  // Contorno por dentro: o tamanho da forma é o tamanho total, com a borda.
  const sw = Math.min(s.strokeWidth, Math.min(w, h) / 2);
  const inset = sw / 2;
  ctx.beginPath();
  if (s.type === "ellipse") {
    ctx.ellipse(w / 2, h / 2, Math.max(0, w / 2 - inset), Math.max(0, h / 2 - inset), 0, 0, Math.PI * 2);
  } else {
    const r = Math.max(0, Math.min(s.radius, Math.min(w, h) / 2) - inset);
    ctx.roundRect(inset, inset, w - sw, h - sw, r);
  }
  if (s.fill !== "none") {
    ctx.fillStyle = s.fill;
    ctx.fill();
  }
  if (sw > 0) {
    ctx.strokeStyle = s.stroke;
    ctx.lineWidth = sw;
    ctx.stroke();
  }
}

const cache = new Map<string, OffscreenCanvas>();

/**
 * Desenho da forma para `outScale` (saída ÷ projeto) e escala do clipe `scale`.
 * O canvas devolvido não muda depois de criado (o compositor guarda a textura dele).
 */
export function shapeImage(s: ShapeStyle, outScale: number, scale: number): OffscreenCanvas {
  const size = shapeSize(s);
  const r = rasterSize(size, outScale, scale);
  const key = `${s.type}|${s.width}|${s.height}|${s.fill}|${s.stroke}|${s.strokeWidth}|${s.radius}|${r.width}x${r.height}`;
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  const canvas = new OffscreenCanvas(r.width, r.height);
  const ctx = canvas.getContext("2d")!;
  ctx.scale(r.width / size.width, r.height / size.height);
  draw(ctx, s, size);
  cache.set(key, canvas);
  if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!);
  return canvas;
}
