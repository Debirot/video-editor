import { describe, expect, it } from "vitest";
import { DEFAULT_SHAPES } from "@/project/normalize";
import { rasterSize, shapeSize, MAX_RASTER } from "./shapes";

describe("shapeSize", () => {
  it("retângulo e elipse usam largura × altura; linha usa a espessura como altura", () => {
    expect(shapeSize({ ...DEFAULT_SHAPES.rect, width: 300, height: 100 })).toEqual({ width: 300, height: 100, natural: true });
    expect(shapeSize({ ...DEFAULT_SHAPES.line, width: 500, height: 999, strokeWidth: 6 })).toEqual({ width: 500, height: 6, natural: true });
    expect(shapeSize({ ...DEFAULT_SHAPES.line, strokeWidth: 0 }).height).toBe(1);
  });
});

describe("rasterSize", () => {
  it("desenha no tamanho em que vai aparecer (saída menor, escala maior)", () => {
    expect(rasterSize({ width: 400, height: 200 }, 0.5, 1)).toEqual({ width: 200, height: 100, ratio: 0.5 });
    expect(rasterSize({ width: 400, height: 200 }, 1, 2.5)).toEqual({ width: 1000, height: 500, ratio: 2.5 });
  });

  it("nunca passa do limite nem fica com menos de 1 px, mantendo a proporção", () => {
    const big = rasterSize({ width: 8000, height: 2000 }, 1, 4);
    expect(big.width).toBe(MAX_RASTER);
    expect(big.height).toBe(MAX_RASTER / 4);
    const tiny = rasterSize({ width: 10, height: 2 }, 0.25, 0.01);
    expect([tiny.width, tiny.height]).toEqual([1, 1]);
  });
});
