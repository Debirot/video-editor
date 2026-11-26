import { describe, expect, it } from "vitest";
import { makeSmallProject } from "@/project/fixtures";
import { hitTest } from "./hitTest";
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
});
