import { describe, expect, it } from "vitest";
import { envelopePoints, fadeFactor } from "./envelope";

const clip = { clipStart: 0, clipEnd: 10_000_000, fadeIn: 1_000_000, fadeOut: 2_000_000 };

describe("envelope de volume", () => {
  it("fadeFactor sobe no início, desce no fim e é 1 no meio", () => {
    expect(fadeFactor(0, clip)).toBe(0);
    expect(fadeFactor(500_000, clip)).toBe(0.5);
    expect(fadeFactor(5_000_000, clip)).toBe(1);
    expect(fadeFactor(9_000_000, clip)).toBe(0.5);
    expect(fadeFactor(10_000_000, clip)).toBe(0);
    expect(fadeFactor(3_000_000, { ...clip, fadeIn: 0, fadeOut: 0 })).toBe(1);
  });

  it("fades que se cruzam (clipe curto) usam o menor", () => {
    const short = { clipStart: 0, clipEnd: 1_000_000, fadeIn: 1_000_000, fadeOut: 1_000_000 };
    expect(fadeFactor(500_000, short)).toBe(0.5);
    expect(fadeFactor(250_000, short)).toBe(0.25);
  });

  it("envelopePoints inclui só as quebras dentro do trecho", () => {
    expect(envelopePoints({ ...clip, start: 0, end: 4_000_000 })).toEqual([0, 1_000_000, 4_000_000]);
    expect(envelopePoints({ ...clip, start: 4_000_000, end: 10_000_000 })).toEqual([4_000_000, 8_000_000, 10_000_000]);
    expect(envelopePoints({ ...clip, start: 2_000_000, end: 3_000_000 })).toEqual([2_000_000, 3_000_000]);
  });
});
