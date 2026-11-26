import { describe, expect, it } from "vitest";
import { formatDecimal, parseDecimal } from "./number-field";

describe("formatDecimal / parseDecimal", () => {
  it("vírgula e menos tipográfico, nos dois sentidos", () => {
    expect(formatDecimal(-6.5, 1)).toBe("−6,5");
    expect(formatDecimal(0.25, 2)).toBe("0,25");
    expect(parseDecimal("−6,5 dB")).toBe(-6.5);
    expect(parseDecimal("-6.5")).toBe(-6.5);
    expect(parseDecimal("0,25s")).toBe(0.25);
    expect(parseDecimal("12")).toBe(12);
    expect(parseDecimal("abc")).toBeNull();
  });
});
