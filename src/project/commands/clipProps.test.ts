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
