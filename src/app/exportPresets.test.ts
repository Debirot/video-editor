import { describe, expect, it } from "vitest";
import { bitrateFor, estimateBytes, fpsOptions, resolutionOptions } from "./exportPresets";

describe("resolutionOptions", () => {
  it("16:9 1080p: 4K, 1440p, 1080p (do projeto), 720p, 480p", () => {
    expect(resolutionOptions(1920, 1080).map((r) => `${r.width}x${r.height}`)).toEqual([
      "3840x2160",
      "2560x1440",
      "1920x1080",
      "1280x720",
      "854x480",
    ]);
    expect(resolutionOptions(1920, 1080).find((r) => r.width === 1920)!.label).toContain("do projeto");
  });

  it("vertical 9:16 mantém a proporção e dimensões pares", () => {
    const opts = resolutionOptions(1080, 1920);
    expect(opts.map((r) => `${r.width}x${r.height}`)).toContain("720x1280");
    expect(opts.every((r) => r.width % 2 === 0 && r.height % 2 === 0)).toBe(true);
  });

  it("projeto fora do padrão aparece também", () => {
    expect(resolutionOptions(1000, 1000).map((r) => r.width)).toContain(1000);
  });
});

describe("fpsOptions", () => {
  it("projeto primeiro, sem repetir", () => {
    const opts = fpsOptions({ num: 30, den: 1 });
    expect(opts[0]!.label).toBe("30 (do projeto)");
    expect(opts.filter((o) => o.label.startsWith("30")).length).toBe(1);
    expect(fpsOptions({ num: 30000, den: 1001 })[0]!.label).toBe("29,97 (do projeto)");
  });
});

describe("bitrateFor / estimateBytes", () => {
  it("1080p30 alta ≈ 9,3 Mb/s; H.265 menos; mínimo 1 Mb/s", () => {
    expect(bitrateFor(1920, 1080, { num: 30, den: 1 }, "alta", "avc")).toBe(9_300_000);
    expect(bitrateFor(1920, 1080, { num: 30, den: 1 }, "alta", "hevc")).toBe(6_100_000);
    expect(bitrateFor(320, 240, { num: 24, den: 1 }, "baixa", "avc")).toBe(1_000_000);
  });

  it("estimativa em bytes", () => {
    expect(estimateBytes(8_000_000, false, 10_000_000)).toBe(10_000_000);
    expect(estimateBytes(8_000_000, true, 10_000_000)).toBe(10_240_000);
  });
});
