import { describe, expect, it } from "vitest";
import { makeClip, makeSmallProject } from "@/project/fixtures";
import { frameStart, videoLayersAt } from "./evaluate";

describe("videoLayersAt", () => {
  it("clipe sob t com tempo na fonte (sourceIn, speed)", () => {
    const p = makeSmallProject(); // V1: c_1 0–2 s; c_2 2–5 s (sourceIn 10 s); c_3 6–8 s (speed 2)
    expect(videoLayersAt(p, 1_000_000)).toMatchObject([
      { clipId: "c_1", mediaId: "m_a", kind: "video", sourceTime: 1_000_000, opacity: 1, transform: { scale: 1 } },
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

import { audioSegmentsIn, dbToGain } from "./evaluate";
import type { Project } from "@/project/types";

/** A1: c_a1 0–4 s (fonte desde 10 s, -6 dB, fades); A2: c_a2 2–8 s (música). */
function audioProject(): Project {
  const p = makeSmallProject();
  p.media[0]!.probe.audioCodec = "aac";
  p.media.push({ ...structuredClone(p.media[0]!), id: "m_song", kind: "audio" });
  const a1 = p.tracks.find((t) => t.id === "t_a1")!;
  a1.clips = [makeClip({ id: "c_a1", start: 0, duration: 4_000_000, sourceIn: 10_000_000, audio: { gainDb: -6, fadeIn: 500_000, fadeOut: 1_000_000 } })];
  p.tracks.push({ ...structuredClone(a1), id: "t_a2", clips: [makeClip({ id: "c_a2", mediaId: "m_song", start: 2_000_000, duration: 6_000_000 })] });
  return p;
}

describe("audioSegmentsIn", () => {
  it("corta os clipes no intervalo e calcula a fonte e o ganho", () => {
    const segs = audioSegmentsIn(audioProject(), 1_000_000, 3_000_000);
    expect(segs.map((s) => [s.clipId, s.start, s.end, s.sourceStart])).toEqual([
      ["c_a1", 1_000_000, 3_000_000, 11_000_000],
      ["c_a2", 2_000_000, 3_000_000, 0],
    ]);
    expect(segs[0]!.gain).toBeCloseTo(0.501, 3);
    expect(segs[0]).toMatchObject({ clipStart: 0, clipEnd: 4_000_000, fadeIn: 500_000, fadeOut: 1_000_000 });
  });

  it("mudo, solo e volume mínimo silenciam", () => {
    const p = audioProject();
    p.tracks.find((t) => t.id === "t_a2")!.muted = true;
    expect(audioSegmentsIn(p, 0, 8_000_000).map((s) => s.clipId)).toEqual(["c_a1"]);
    p.tracks.find((t) => t.id === "t_a2")!.muted = false;
    p.tracks.find((t) => t.id === "t_a2")!.solo = true;
    expect(audioSegmentsIn(p, 0, 8_000_000).map((s) => s.clipId)).toEqual(["c_a2"]);
    p.tracks.find((t) => t.id === "t_a2")!.gainDb = -60;
    expect(audioSegmentsIn(p, 0, 8_000_000)).toEqual([]);
  });

  it("clipes de vídeo, mídia sem áudio ou ausente não tocam", () => {
    const p = audioProject();
    expect(audioSegmentsIn(p, 0, 8_000_000).some((s) => s.clipId.startsWith("c_1"))).toBe(false);
    p.media[0]!.probe.audioCodec = undefined;
    expect(audioSegmentsIn(p, 0, 8_000_000).map((s) => s.clipId)).toEqual(["c_a2"]);
    p.media[1]!.missing = true;
    expect(audioSegmentsIn(p, 0, 8_000_000)).toEqual([]);
  });

  it("dbToGain", () => {
    expect(dbToGain(0)).toBe(1);
    expect(dbToGain(-60)).toBe(0);
    expect(dbToGain(6)).toBeCloseTo(1.995, 3);
  });
});
