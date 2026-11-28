import { describe, expect, it } from "vitest";
import { parseHexColor } from "./color-field";

describe("parseHexColor", () => {
  it("aceita com ou sem #, maiúsculas, e forma curta de 3 dígitos", () => {
    expect(parseHexColor("#FF8800")).toBe("#ff8800");
    expect(parseHexColor("ff8800")).toBe("#ff8800");
    expect(parseHexColor("  #f80 ")).toBe("#ff8800");
  });

  it("recusa o resto", () => {
    expect(parseHexColor("")).toBeNull();
    expect(parseHexColor("#ff88")).toBeNull();
    expect(parseHexColor("vermelho")).toBeNull();
    expect(parseHexColor("#gg0000")).toBeNull();
  });
});
