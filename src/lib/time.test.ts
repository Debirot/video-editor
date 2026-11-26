import { describe, expect, it } from "vitest";
import {
  formatTimecode,
  frameToUs,
  parseTimecode,
  secondsToUs,
  snapToFrame,
  usToFrame,
  type Rational,
} from "./time";

const FPS: Record<string, Rational> = {
  "23.976": { num: 24000, den: 1001 },
  "24": { num: 24, den: 1 },
  "25": { num: 25, den: 1 },
  "29.97": { num: 30000, den: 1001 },
  "30": { num: 30, den: 1 },
  "59.94": { num: 60000, den: 1001 },
  "60": { num: 60, den: 1 },
};

describe("frameToUs / usToFrame", () => {
  it.each([
    ["30", 1, 33_333],
    ["30", 3, 100_000],
    ["29.97", 1, 33_367],
    ["29.97", 30, 1_001_000],
    ["23.976", 1, 41_708],
    ["23.976", 24, 1_001_000],
    ["25", 25, 1_000_000],
  ])("fps %s, quadro %i começa em %i µs", (fps, frame, us) => {
    expect(frameToUs(frame, FPS[fps]!)).toBe(us);
  });

  it.each(Object.keys(FPS))("ida e volta exata em %s fps até 10 h", (key) => {
    const fps = FPS[key]!;
    const lastFrame = Math.ceil((10 * 3600 * fps.num) / fps.den);
    for (let n = 0; n <= lastFrame; n += 997) {
      const t = frameToUs(n, fps);
      expect(Number.isInteger(t)).toBe(true);
      expect(usToFrame(t, fps)).toBe(n);
      // Qualquer instante dentro do quadro pertence a ele.
      expect(usToFrame(frameToUs(n + 1, fps) - 1, fps)).toBe(n);
    }
  });

  it("ida e volta em todos os quadros da primeira hora a 29,97", () => {
    const fps = FPS["29.97"]!;
    for (let n = 0; n < 108_000; n++) {
      expect(usToFrame(frameToUs(n, fps), fps)).toBe(n);
    }
  });
});

describe("snapToFrame", () => {
  it("arredonda ao quadro mais próximo", () => {
    const fps = FPS["30"]!;
    expect(snapToFrame(16_000, fps)).toBe(0);
    expect(snapToFrame(17_000, fps)).toBe(33_333);
    expect(snapToFrame(1_000_000, fps)).toBe(1_000_000);
  });

  it("é idempotente em 23,976", () => {
    const fps = FPS["23.976"]!;
    for (const t of [0, 1, 20_853, 20_855, 41_708, 123_456_789]) {
      const s = snapToFrame(t, fps);
      expect(snapToFrame(s, fps)).toBe(s);
      expect(Number.isInteger(s)).toBe(true);
    }
  });
});

describe("timecode", () => {
  it.each([
    ["30", 0, "00:00:00:00"],
    ["30", 8_400_000, "00:00:08:12"],
    ["30", 3_600_000_000, "01:00:00:00"],
    ["25", 61_040_000, "00:01:01:01"],
  ])("fps %s, %i µs → %s", (fps, us, tc) => {
    expect(formatTimecode(us, FPS[fps]!)).toBe(tc);
  });

  it("29,97 usa FPS nominal 30 sem drop-frame", () => {
    const fps = FPS["29.97"]!;
    expect(formatTimecode(frameToUs(30, fps), fps)).toBe("00:00:01:00");
    expect(formatTimecode(frameToUs(29, fps), fps)).toBe("00:00:00:29");
  });

  it("parse e format são inversos em quadros inteiros", () => {
    for (const key of Object.keys(FPS)) {
      const fps = FPS[key]!;
      for (const n of [0, 1, 59, 1_000, 86_399, 500_000]) {
        const t = frameToUs(n, fps);
        expect(parseTimecode(formatTimecode(t, fps), fps)).toBe(t);
      }
    }
  });

  it("aceita formas curtas e recusa entradas inválidas", () => {
    const fps = FPS["30"]!;
    expect(parseTimecode("08:12", fps)).toBe(frameToUs(8 * 30 + 12, fps));
    expect(parseTimecode("1:00:00", fps)).toBe(60_000_000);
    expect(parseTimecode("00:00:00:30", fps)).toBeNull();
    expect(parseTimecode("00:61:00:00", fps)).toBeNull();
    expect(parseTimecode("abc", fps)).toBeNull();
    expect(parseTimecode("", fps)).toBeNull();
  });
});

describe("secondsToUs", () => {
  it("devolve inteiros", () => {
    expect(secondsToUs(1.5)).toBe(1_500_000);
    expect(secondsToUs(0.1 + 0.2)).toBe(300_000);
  });
});
