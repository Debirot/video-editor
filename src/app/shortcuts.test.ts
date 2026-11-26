import { describe, expect, it } from "vitest";
import { actionFor, comboFromEvent, SHORTCUTS, type KeyLike } from "./shortcuts";

const key = (k: string, mods: Partial<KeyLike> = {}): KeyLike => ({
  key: k,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  ...mods,
});

describe("comboFromEvent", () => {
  it.each([
    [key("z", { ctrlKey: true }), "Ctrl+Z"],
    [key("Z", { ctrlKey: true, shiftKey: true }), "Ctrl+Shift+Z"],
    [key("z", { metaKey: true }), "Ctrl+Z"],
    [key("s"), "S"],
    [key(" "), "Space"],
    [key("ArrowLeft", { shiftKey: true }), "Shift+ArrowLeft"],
    [key("+", { shiftKey: true }), "+"],
    [key("Delete", { shiftKey: true }), "Shift+Delete"],
  ])("%j → %s", (e, combo) => {
    expect(comboFromEvent(e)).toBe(combo);
  });
});

describe("actionFor", () => {
  it("mapeia os atalhos do plano", () => {
    expect(actionFor(key("s"))).toBe("split");
    expect(actionFor(key("z", { ctrlKey: true }))).toBe("undo");
    expect(actionFor(key("Z", { ctrlKey: true, shiftKey: true }))).toBe("redo");
    expect(actionFor(key("Delete"))).toBe("delete");
    expect(actionFor(key("Delete", { shiftKey: true }))).toBe("rippleDelete");
    expect(actionFor(key("d", { ctrlKey: true }))).toBe("duplicate");
    expect(actionFor(key("ArrowUp"))).toBe("prevCut");
    expect(actionFor(key("+", { shiftKey: true }))).toBe("zoomIn");
    expect(actionFor(key("="))).toBe("zoomIn");
    expect(actionFor(key("n"))).toBe("toggleSnap");
    expect(actionFor(key(" "))).toBe("togglePlay");
    expect(actionFor(key("j"))).toBe("shuttleBack");
    expect(actionFor(key("k"))).toBe("stop");
    expect(actionFor(key("l"))).toBe("shuttleForward");
  });

  it("teclas sem atalho e combinações diferentes não disparam", () => {
    expect(actionFor(key("q"))).toBeNull();
    expect(actionFor(key("s", { ctrlKey: true }))).toBeNull(); // Ctrl+S é salvar (T1.09)
    expect(actionFor(key("s", { altKey: true }))).toBeNull();
  });

  it("todas as combinações do mapa estão normalizadas", () => {
    for (const combo of Object.keys(SHORTCUTS)) {
      const parts = combo === "+" ? ["+"] : combo.split("+");
      const k = parts[parts.length - 1]!;
      const e = key(k === "Space" ? " " : k.length === 1 ? k.toLowerCase() : k, {
        ctrlKey: parts.includes("Ctrl"),
        shiftKey: parts.includes("Shift"),
        altKey: parts.includes("Alt"),
      });
      expect(comboFromEvent(e)).toBe(combo);
    }
  });
});
