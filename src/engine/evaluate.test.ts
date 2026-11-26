import { describe, expect, it } from "vitest";
import { makeClip, makeSmallProject } from "@/project/fixtures";
import { frameStart, videoLayersAt } from "./evaluate";

describe("videoLayersAt", () => {
  it("clipe sob t com tempo na fonte (sourceIn, speed)", () => {
    const p = makeSmallProject(); // V1: c_1 0–2 s; c_2 2–5 s (sourceIn 10 s); c_3 6–8 s (speed 2)
    expect(videoLayersAt(p, 1_000_000)).toEqual([
      { clipId: "c_1", mediaId: "m_a", kind: "video", sourceTime: 1_000_000, opacity: 1 },
    ]);
    expect(videoLayersAt(p, 3_000_000)[0]!.sourceTime).toBe(11_000_000);
    expect(videoLayersAt(p, 7_000_000)[0]!.sourceTime).toBe(2_000_000);
    expect(videoLayersAt(p, 5_500_000)).toEqual([]); // buraco
  });

  it("trilhas de baixo para cima; oculta, clipe desligado e trilha de áudio não entram", () => {
    const p = makeSmallProject();
    p.tracks.splice(1, 0, { ...structuredClone(p.tracks[0]!), id: "t_v2", clips: [makeClip({ id: "c_top", start: 0, duration: 3_000_000 })] });
    expect(videoLayersAt(p, 1_000_000).map((l) => l.clipId)).toEqual(["c_1", "c_top"]);
    p.tracks[1]!.hidden = true;
    expect(videoLayersAt(p, 1_000_000).map((l) => l.clipId)).toEqual(["c_1"]);
    p.tracks[0]!.clips[0]!.enabled = false;
    expect(videoLayersAt(p, 1_000_000)).toEqual([]);
  });

  it("mídia ausente, de áudio ou inexistente é ignorada; imagem usa tempo 0", () => {
    const p = makeSmallProject();
    p.media[0]!.missing = true;
    expect(videoLayersAt(p, 1_000_000)).toEqual([]);
    p.media[0]!.missing = false;
    p.media[0]!.kind = "image";
    expect(videoLayersAt(p, 3_000_000)[0]).toMatchObject({ kind: "image", sourceTime: 0 });
    p.tracks[0]!.clips[0]!.mediaId = "m_nao_existe";
    expect(videoLayersAt(p, 1_000_000)).toEqual([]);
  });

  it("tempo na fonte nunca passa do fim da mídia", () => {
    const p = makeSmallProject();
    p.media[0]!.probe.duration = 10_500_000; // c_2 começa em 10 s da fonte
    expect(videoLayersAt(p, 4_000_000)[0]!.sourceTime).toBe(10_499_999);
  });
});

describe("frameStart", () => {
  it("arredonda para o início do quadro", () => {
    expect(frameStart(50_000, { num: 30, den: 1 })).toBe(33_333);
    expect(frameStart(33_333, { num: 30, den: 1 })).toBe(33_333);
    expect(frameStart(33_332, { num: 30, den: 1 })).toBe(0);
  });
});
