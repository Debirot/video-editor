import { describe, expect, it } from "vitest";
import { makeSmallProject } from "@/project/fixtures";
import { clipsInRect, hitTest, trackAtY } from "./hitTest";
import { RULER_HEIGHT, SEPARATOR_HEIGHT, TRACK_HEIGHT, trackLayout } from "./viewport";

describe("hitTest", () => {
  const p = makeSmallProject(); // V1: c_1 0–2 s, c_2 2–5 s, c_3 6–8 s; A1 vazia
  const layout = trackLayout(p.tracks);
  const vp = { pxPerSecond: 100, scrollX: 0, width: 1000 };
  const v1Y = RULER_HEIGHT + TRACK_HEIGHT / 2;
  const a1Y = RULER_HEIGHT + TRACK_HEIGHT + SEPARATOR_HEIGHT + TRACK_HEIGHT / 2;

  it("régua", () => {
    expect(hitTest(250, 5, vp, 0, layout, p.tracks)).toEqual({ area: "ruler", t: 2_500_000 });
  });

  it("clipe sob o ponteiro, ou trilha vazia naquele ponto", () => {
    expect(hitTest(250, v1Y, vp, 0, layout, p.tracks)).toMatchObject({ area: "track", trackId: "t_v1", clipId: "c_2" });
    expect(hitTest(550, v1Y, vp, 0, layout, p.tracks)).toMatchObject({ area: "track", trackId: "t_v1", clipId: null });
    expect(hitTest(100, a1Y, vp, 0, layout, p.tracks)).toMatchObject({ area: "track", trackId: "t_a1", clipId: null });
  });

  it("faixa entre vídeo e áudio e área abaixo das trilhas", () => {
    expect(hitTest(100, RULER_HEIGHT + TRACK_HEIGHT + 1, vp, 0, layout, p.tracks).area).toBe("empty");
    expect(hitTest(100, 900, vp, 0, layout, p.tracks).area).toBe("empty");
  });

  it("considera a rolagem horizontal e vertical", () => {
    expect(hitTest(50, v1Y, { ...vp, scrollX: 600 }, 0, layout, p.tracks)).toMatchObject({ clipId: "c_3" });
    expect(hitTest(100, v1Y - 10, vp, TRACK_HEIGHT, layout, p.tracks)).toMatchObject({ trackId: "t_a1" });
  });

  it("bordas: perto do início ou do fim do clipe vira aparar", () => {
    // c_2: 2–5 s = 200–500 px; c_1 termina em 200 px (encostado)
    expect(hitTest(203, v1Y, vp, 0, layout, p.tracks)).toMatchObject({ clipId: "c_2", edge: "start" });
    expect(hitTest(197, v1Y, vp, 0, layout, p.tracks)).toMatchObject({ clipId: "c_1", edge: "end" });
    expect(hitTest(496, v1Y, vp, 0, layout, p.tracks)).toMatchObject({ clipId: "c_2", edge: "end" });
    expect(hitTest(350, v1Y, vp, 0, layout, p.tracks)).toMatchObject({ clipId: "c_2", edge: null });
    // fim de c_2 também aceita alguns px para fora (área vazia depois do clipe)
    expect(hitTest(504, v1Y, vp, 0, layout, p.tracks)).toMatchObject({ clipId: "c_2", edge: "end" });
  });

  it("clipe estreito só tem corpo", () => {
    const narrow = { ...vp, pxPerSecond: 5 }; // c_1 = 10 px
    expect(hitTest(5, v1Y, narrow, 0, layout, p.tracks)).toMatchObject({ clipId: "c_1", edge: null });
  });

  it("trackAtY e clipsInRect", () => {
    expect(trackAtY(v1Y, 0, layout)).toBe("t_v1");
    expect(trackAtY(5, 0, layout)).toBeNull();
    expect(clipsInRect({ x0: 150, y0: v1Y - 5, x1: 650, y1: v1Y + 5 }, vp, 0, layout, p.tracks)).toEqual(["c_1", "c_2", "c_3"]);
    expect(clipsInRect({ x0: 520, y0: v1Y, x1: 590, y1: v1Y + 1 }, vp, 0, layout, p.tracks)).toEqual([]);
    expect(clipsInRect({ x0: 0, y0: a1Y, x1: 900, y1: a1Y + 2 }, vp, 0, layout, p.tracks)).toEqual([]);
  });
});
