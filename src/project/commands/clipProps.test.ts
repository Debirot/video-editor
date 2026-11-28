import { describe, expect, it } from "vitest";
import { emptyHistory, execute, undo } from "../history";
import { makeClip, makeSmallProject } from "../fixtures";
import { setClipAudio } from "./clipProps";

function withAudioClip() {
  const p = makeSmallProject();
  p.tracks.find((t) => t.id === "t_a1")!.clips.push(
    makeClip({ id: "c_a", start: 0, duration: 4_000_000, audio: { gainDb: 0, fadeIn: 0, fadeOut: 0 } }),
  );
  return { project: p, history: emptyHistory() };
}
const audioOf = (s: ReturnType<typeof withAudioClip>) => s.project.tracks.find((t) => t.id === "t_a1")!.clips[0]!.audio!;

describe("setClipAudio", () => {
  it("muda volume e fades, e desfaz em um passo", () => {
    const s0 = withAudioClip();
    const s1 = execute(s0, "Fade", setClipAudio(["c_a"], { gainDb: -6.04, fadeIn: 1_000_000 }));
    expect(audioOf(s1)).toEqual({ gainDb: -6, fadeIn: 1_000_000, fadeOut: 0 });
    expect(undo(s1).project).toEqual(s0.project);
  });

  it("limita volume e fades; o fade editado empurra o outro", () => {
    let s = withAudioClip();
    s = execute(s, "v", setClipAudio(["c_a"], { gainDb: 40 }));
    expect(audioOf(s).gainDb).toBe(12);
    s = execute(s, "f", setClipAudio(["c_a"], { fadeIn: 3_000_000, fadeOut: 9_000_000 }));
    // fadeOut pedido maior que o clipe → 4 s; então o fadeIn encolhe para caber.
    expect(audioOf(s)).toMatchObject({ fadeIn: 0, fadeOut: 4_000_000 });
    s = execute(s, "f", setClipAudio(["c_a"], { fadeIn: 1_500_000 }));
    expect(audioOf(s)).toMatchObject({ fadeIn: 1_500_000, fadeOut: 2_500_000 });
    s = execute(s, "f", setClipAudio(["c_a"], { fadeIn: -5 }));
    expect(audioOf(s).fadeIn).toBe(0);
  });

  it("ignora clipes de vídeo e trilhas travadas", () => {
    const s0 = withAudioClip();
    expect(execute(s0, "v", setClipAudio(["c_1"], { gainDb: -3 }))).toBe(s0);
    const locked = execute(s0, "t", (d) => void (d.tracks.find((t) => t.id === "t_a1")!.locked = true));
    expect(execute(locked, "v", setClipAudio(["c_a"], { gainDb: -3 }))).toBe(locked);
  });
});

import { resetClipTransform, setClipCrop, setClipTransform } from "./clipProps";

describe("setClipTransform / setClipCrop / resetClipTransform", () => {
  const start = () => ({ project: makeSmallProject(), history: emptyHistory() });
  const clip1 = (s: { project: ReturnType<typeof makeSmallProject> }) => s.project.tracks[0]!.clips[0]!;

  it("muda e limita a transformação; desfaz em um passo", () => {
    const s0 = start();
    const s1 = execute(s0, "t", setClipTransform(["c_1"], { x: 100.04, y: -50, scale: 50, rotation: 45, opacity: 2 }));
    expect(clip1(s1).transform).toEqual({ x: 100, y: -50, scale: 10, rotation: 45, opacity: 1 });
    expect(execute(s1, "t", setClipTransform(["c_1"], { scale: 0 })).project.tracks[0]!.clips[0]!.transform.scale).toBe(0.01);
    expect(undo(s1).project).toEqual(s0.project);
  });

  it("recorte: o lado editado empurra o oposto e sempre sobra algo visível", () => {
    let s = start();
    s = execute(s, "c", setClipCrop(["c_1"], { left: 0.7 }));
    s = execute(s, "c", setClipCrop(["c_1"], { right: 0.5 }));
    expect(clip1(s).crop).toMatchObject({ left: 0.49, right: 0.5 });
    s = execute(s, "c", setClipCrop(["c_1"], { top: 2 }));
    expect(clip1(s).crop.top).toBe(0.99);
  });

  it("redefinir volta ao padrão; clipe de áudio e trilha travada são ignorados", () => {
    let s = execute(start(), "t", setClipTransform(["c_1"], { x: 5, scale: 2 }));
    s = execute(s, "c", setClipCrop(["c_1"], { left: 0.2 }));
    s = execute(s, "r", resetClipTransform(["c_1"]));
    expect(clip1(s).transform).toEqual({ x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 });
    expect(clip1(s).crop).toEqual({ left: 0, top: 0, right: 0, bottom: 0 });
    const locked = execute(start(), "l", (d) => void (d.tracks[0]!.locked = true));
    expect(execute(locked, "t", setClipTransform(["c_1"], { x: 5 }))).toBe(locked);
  });
});
