import { describe, expect, it } from "vitest";
import { makeSmallProject } from "@/project/fixtures";
import { snapBlock, snapPoints, snapThreshold, snapTime } from "./snap";

describe("snap", () => {
  it("pontos: zero, playhead e bordas dos outros clipes", () => {
    const pts = snapPoints(makeSmallProject(), new Set(["c_2"]), 4_200_000).sort((a, b) => a - b);
    expect(pts).toEqual([0, 2_000_000, 4_200_000, 6_000_000, 8_000_000]);
  });

  it("snapTime pega o mais próximo dentro do limiar", () => {
    expect(snapTime(1_950_000, [0, 2_000_000], 100_000)).toBe(2_000_000);
    expect(snapTime(1_800_000, [0, 2_000_000], 100_000)).toBeNull();
    expect(snapTime(1_000_000, [990_000, 1_020_000], 100_000)).toBe(990_000);
  });

  it("snapBlock encaixa a borda mais próxima", () => {
    // bloco 5,95–7,95 s: início a 50 ms de 6 s, fim a 50 ms de 8 s → empate, vence o início
    expect(snapBlock(5_950_000, 7_950_000, [6_000_000, 8_000_000], 100_000)).toBe(50_000);
    // só o fim perto
    expect(snapBlock(5_000_000, 7_980_000, [8_000_000], 100_000)).toBe(20_000);
    expect(snapBlock(5_000_000, 7_000_000, [9_000_000], 100_000)).toBe(0);
  });

  it("limiar de 8 px vira µs conforme o zoom", () => {
    expect(snapThreshold(40)).toBe(200_000);
    expect(snapThreshold(800)).toBe(10_000);
  });
});
