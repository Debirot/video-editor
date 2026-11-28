import { describe, expect, it } from "vitest";
import { DEFAULT_CROP, DEFAULT_TRANSFORM } from "@/project/normalize";
import { containsPoint, placeLayer, placementMatrix, toImage, toScreen, visibleCorners } from "./transform";

const out = { width: 1920, height: 1080 };
const project = { width: 1920, height: 1080 };
const T = (p: Partial<typeof DEFAULT_TRANSFORM> = {}) => ({ ...DEFAULT_TRANSFORM, ...p });
const C = (p: Partial<typeof DEFAULT_CROP> = {}) => ({ ...DEFAULT_CROP, ...p });
const r = (n: number) => Math.round(n) + 0; // + 0 transforma −0 em 0
const round = (pts: [number, number][]) => pts.map(([x, y]) => [r(x), r(y)]);

describe("placeLayer", () => {
  it("tamanho próprio (formas): escala 1 = tamanho em px do projeto, sem encaixe", () => {
    const shape = { width: 400, height: 200, natural: true };
    const p = placeLayer(shape, out, project, T({ x: 100 }), C());
    expect(round(visibleCorners(p))).toEqual([[860, 440], [1260, 440], [1260, 640], [860, 640]]);
    // preview em 1/2 e escala 2: mesmo lugar relativo, o dobro do tamanho
    const half = placeLayer(shape, { width: 960, height: 540 }, project, T({ x: 100, scale: 2 }), C());
    expect([r(half.cx), r(half.cy), r(half.w), r(half.h)]).toEqual([530, 270, 400, 200]);
  });

  it("sem transformação = encaixe centralizado (vertical com faixas)", () => {
    const p = placeLayer({ width: 1080, height: 1920 }, out, project, T(), C());
    expect([p.cx, p.cy, Math.round(p.w), p.h]).toEqual([960, 540, 608, 1080]);
    expect(round(visibleCorners(p))).toEqual([[656, 0], [1264, 0], [1264, 1080], [656, 1080]]);
  });

  it("posição em px do projeto e escala; no preview em 1/2 tudo cai pela metade", () => {
    const p = placeLayer({ width: 1920, height: 1080 }, out, project, T({ x: 480, y: -270, scale: 0.5 }), C());
    expect(round(visibleCorners(p))).toEqual([[960, 0], [1920, 0], [1920, 540], [960, 540]]);
    const half = placeLayer({ width: 1920, height: 1080 }, { width: 960, height: 540 }, project, T({ x: 480, y: -270, scale: 0.5 }), C());
    expect(round(visibleCorners(half))).toEqual([[480, 0], [960, 0], [960, 270], [480, 270]]);
  });

  it("rotação de 90° no sentido horário", () => {
    const p = placeLayer({ width: 1000, height: 500 }, { width: 1000, height: 1000 }, { width: 1000, height: 1000 }, T({ rotation: 90 }), C());
    // canto superior esquerdo da imagem vai para a direita em cima
    const [x, y] = toScreen(p, 0, 0);
    expect([r(x), r(y)]).toEqual([750, 0]);
  });

  it("vídeo de celular gravado com rotação 90 fica em pé e preenche a altura", () => {
    // arquivo 1920×1080 com rotação 90 = mostrado 1080×1920
    const p = placeLayer({ width: 1920, height: 1080, rotation: 90 }, out, project, T(), C());
    const xs = visibleCorners(p).map(([x]) => x);
    const ys = visibleCorners(p).map(([, y]) => y);
    expect(r(Math.min(...ys))).toBe(0);
    expect(Math.round(Math.max(...ys))).toBe(1080);
    expect(Math.round(Math.max(...xs) - Math.min(...xs))).toBe(608);
  });

  it("recorte esconde as bordas sem mover o resto", () => {
    const p = placeLayer({ width: 1920, height: 1080 }, out, project, T(), C({ left: 0.25, bottom: 0.5 }));
    expect(round(visibleCorners(p))).toEqual([[480, 0], [1920, 0], [1920, 540], [480, 540]]);
    expect(p.uv).toEqual([0.25, 0, 1, 0.5]);
  });

  it("recorte que fecharia a imagem deixa um mínimo visível", () => {
    const p = placeLayer({ width: 100, height: 100 }, out, project, T(), C({ left: 0.6, right: 0.6 }));
    expect(p.uv[2] - p.uv[0]).toBeCloseTo(0.01);
  });
});

describe("ida e volta e matriz", () => {
  const p = placeLayer({ width: 1920, height: 1080 }, out, project, T({ x: 100, y: 50, scale: 0.7, rotation: 33 }), C({ top: 0.1 }));

  it("toImage desfaz toScreen", () => {
    for (const [u, v] of [[0, 0], [0.3, 0.8], [1, 1]] as const) {
      const [x, y] = toScreen(p, u, v);
      const [u2, v2] = toImage(p, x, y);
      expect(u2).toBeCloseTo(u, 6);
      expect(v2).toBeCloseTo(v, 6);
    }
  });

  it("containsPoint respeita rotação e recorte", () => {
    expect(containsPoint(p, p.cx, p.cy)).toBe(true);
    const [x, y] = toScreen(p, 0.5, 0.05); // área recortada em cima
    expect(containsPoint(p, x, y)).toBe(false);
  });

  it("a matriz do WebGL leva (u, v) ao mesmo ponto que toScreen", () => {
    const m = placementMatrix(p);
    for (const [u, v] of [[0, 0], [1, 0.5], [0.2, 0.9]] as const) {
      const x = m[0]! * u + m[3]! * v + m[6]!;
      const y = m[1]! * u + m[4]! * v + m[7]!;
      const [ex, ey] = toScreen(p, u, v);
      expect(x).toBeCloseTo(ex, 3);
      expect(y).toBeCloseTo(ey, 3);
    }
  });
});
