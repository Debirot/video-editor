import { describe, expect, it } from "vitest";
import { clipAt, findClip, projectDuration, sourceTimeAt, trackProblems } from "./queries";
import { makeClip, makeSmallProject } from "./fixtures";

describe("clipAt", () => {
  const track = makeSmallProject().tracks[0]!;

  it.each([
    [0, "c_1"],
    [1_999_999, "c_1"],
    [2_000_000, "c_2"],
    [4_999_999, "c_2"],
    [5_000_000, undefined], // buraco entre 5 s e 6 s
    [6_000_000, "c_3"],
    [8_000_000, undefined], // fim é exclusivo
    [-1, undefined],
  ])("em %i µs → %s", (t, id) => {
    expect(clipAt(track, t)?.id).toBe(id);
  });

  it("trilha vazia", () => {
    expect(clipAt(makeSmallProject().tracks[1]!, 0)).toBeUndefined();
  });
});

describe("sourceTimeAt", () => {
  it("aplica sourceIn e velocidade", () => {
    const p = makeSmallProject();
    expect(sourceTimeAt(findClip(p, "c_2")!.clip, 3_000_000)).toBe(11_000_000);
    expect(sourceTimeAt(findClip(p, "c_3")!.clip, 7_000_000)).toBe(2_000_000);
  });

  it("freeze sempre devolve o mesmo quadro", () => {
    const c = makeClip({ id: "c_f", kind: "freeze", start: 0, duration: 5_000_000, sourceIn: 1_234_000 });
    expect(sourceTimeAt(c, 4_000_000)).toBe(1_234_000);
  });
});

describe("projectDuration / trackProblems", () => {
  it("duração é o fim do último clipe", () => {
    expect(projectDuration(makeSmallProject())).toBe(8_000_000);
  });

  it("detecta sobreposição e tempos não inteiros", () => {
    const track = makeSmallProject().tracks[0]!;
    expect(trackProblems(track)).toEqual([]);
    track.clips[1]!.start = 1_500_000;
    track.clips[2]!.duration = 0.5;
    expect(trackProblems(track)).toEqual(["c_2: sobrepõe o clipe anterior", "c_3: tempo não inteiro"]);
  });
});
