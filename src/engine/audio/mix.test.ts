import { describe, expect, it } from "vitest";
import type { PcmChunk } from "../messages";
import { clampInPlace, MIX_RATE, mixInto, sampleIndex, silence } from "./mix";

function chunk(partial: Partial<PcmChunk> & { channels: Float32Array[]; sampleRate: number }): PcmChunk {
  return { clipId: "c", start: 0, end: 1_000_000, speed: 1, gain: 1, clipStart: 0, clipEnd: 1_000_000, fadeIn: 0, fadeOut: 0, ...partial };
}

const constant = (value: number, length: number) => new Float32Array(length).fill(value);
const ramp = (length: number) => Float32Array.from({ length }, (_, i) => i / length);

describe("mixInto", () => {
  it("reamostra 44,1 kHz mono para 48 kHz estéreo no lugar certo", () => {
    const out = silence(0, 2_000_000);
    expect(out[0]!.length).toBe(2 * MIX_RATE);
    mixInto(out, 0, chunk({ start: 500_000, end: 1_500_000, clipStart: 500_000, clipEnd: 1_500_000, sampleRate: 44_100, channels: [constant(0.5, 44_100)] }));
    expect(out[0]![sampleIndex(400_000)]).toBe(0);
    expect(out[0]![sampleIndex(1_000_000)]).toBeCloseTo(0.5, 5);
    expect(out[1]![sampleIndex(1_000_000)]).toBeCloseTo(0.5, 5);
    expect(out[0]![sampleIndex(1_600_000)]).toBe(0);
  });

  it("soma trechos e aplica ganho", () => {
    const out = silence(0, 1_000_000);
    mixInto(out, 0, chunk({ sampleRate: 48_000, channels: [constant(0.25, 48_000)], gain: 2 }));
    mixInto(out, 0, chunk({ sampleRate: 48_000, channels: [constant(0.1, 48_000), constant(-0.1, 48_000)] }));
    expect(out[0]![100]).toBeCloseTo(0.6, 5);
    expect(out[1]![100]).toBeCloseTo(0.4, 5);
  });

  it("fades: começa em silêncio e chega ao volume cheio no fim do fade", () => {
    const out = silence(0, 1_000_000);
    mixInto(out, 0, chunk({ sampleRate: 48_000, channels: [constant(1, 48_000)], fadeIn: 500_000, fadeOut: 200_000 }));
    expect(out[0]![0]).toBe(0);
    expect(out[0]![sampleIndex(250_000)]).toBeCloseTo(0.5, 3);
    expect(out[0]![sampleIndex(600_000)]).toBe(1);
    expect(out[0]![sampleIndex(900_000)]).toBeCloseTo(0.5, 3);
  });

  it("buffer que começa no meio do trecho lê a fonte a partir do ponto certo", () => {
    const out = silence(500_000, 1_000_000);
    mixInto(out, 500_000, chunk({ sampleRate: 48_000, channels: [ramp(48_000)] }));
    expect(out[0]![0]).toBeCloseTo(0.5, 4);
  });

  it("speed 2 lê a fonte duas vezes mais rápido", () => {
    const out = silence(0, 500_000);
    mixInto(out, 0, chunk({ end: 500_000, clipEnd: 500_000, speed: 2, sampleRate: 48_000, channels: [ramp(48_000)] }));
    expect(out[0]![sampleIndex(250_000)]).toBeCloseTo(0.5, 4);
  });

  it("clampInPlace corta picos", () => {
    const out = [Float32Array.from([1.5, -2, 0.3])];
    clampInPlace(out);
    expect([...out[0]!]).toEqual([1, -1, expect.closeTo(0.3, 5)]);
  });
});
