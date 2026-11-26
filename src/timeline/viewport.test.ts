import { describe, expect, it } from "vitest";
import { frameToUs } from "@/lib/time";
import { makeSmallProject } from "@/project/fixtures";
import {
  clampScrollX,
  fitZoom,
  MAX_PX_PER_SECOND,
  MIN_PX_PER_SECOND,
  rulerLabel,
  rulerTicks,
  SEPARATOR_HEIGHT,
  timeToX,
  TRACK_HEIGHT,
  trackLayout,
  xToTime,
  zoomAt,
  type Viewport,
} from "./viewport";

const FPS30 = { num: 30, den: 1 };
const FPS2997 = { num: 30000, den: 1001 };
const vp = (pxPerSecond: number, scrollX = 0, width = 1000): Viewport => ({ pxPerSecond, scrollX, width });

describe("tempo ↔ pixel", () => {
  it("converte nos dois sentidos com rolagem", () => {
    const v = vp(100, 250);
    expect(timeToX(5_000_000, v)).toBe(250);
    expect(xToTime(250, v)).toBe(5_000_000);
    expect(xToTime(0, vp(100))).toBe(0);
  });

  it("xToTime devolve inteiro e nunca negativo", () => {
    const t = xToTime(33, vp(7));
    expect(Number.isInteger(t)).toBe(true);
    expect(xToTime(-500, vp(100))).toBe(0);
  });
});

describe("zoomAt", () => {
  it("mantém o tempo sob o cursor", () => {
    const v = vp(100, 300);
    const anchor = 400;
    const before = xToTime(anchor, v);
    const z = zoomAt(v, 2, anchor);
    expect(z.pxPerSecond).toBe(200);
    expect(xToTime(anchor, { ...v, ...z })).toBe(before);
  });

  it("respeita os limites e não rola para antes do zero", () => {
    expect(zoomAt(vp(MAX_PX_PER_SECOND), 4, 0).pxPerSecond).toBe(MAX_PX_PER_SECOND);
    expect(zoomAt(vp(MIN_PX_PER_SECOND), 0.1, 0).pxPerSecond).toBe(MIN_PX_PER_SECOND);
    expect(zoomAt(vp(100, 0), 0.5, 500).scrollX).toBe(0);
  });
});

describe("rolagem e enquadramento", () => {
  it("o fim do conteúdo pode ir até a metade da tela", () => {
    const v = vp(100, 0, 1000);
    expect(clampScrollX(99_999, 20_000_000, v)).toBe(1500);
    expect(clampScrollX(-10, 20_000_000, v)).toBe(0);
    expect(clampScrollX(300, 0, v)).toBe(0);
  });

  it("fitZoom mostra o conteúdo com folga", () => {
    expect(fitZoom(60_000_000, 1200)).toBeCloseTo(18);
    expect(fitZoom(0, 1200)).toBe(40);
  });
});

describe("trackLayout", () => {
  it("vídeo de cima para baixo (V2 acima de V1), faixa, depois áudio", () => {
    const p = makeSmallProject();
    p.tracks.splice(1, 0, { ...p.tracks[0]!, id: "t_v2", name: "V2", clips: [] });
    const layout = trackLayout(p.tracks);
    expect(layout.rows.map((r) => r.trackId)).toEqual(["t_v2", "t_v1", "t_a1"]);
    expect(layout.rows.map((r) => r.y)).toEqual([0, TRACK_HEIGHT, 2 * TRACK_HEIGHT + SEPARATOR_HEIGHT]);
    expect(layout.separatorY).toBe(2 * TRACK_HEIGHT);
    expect(layout.height).toBe(3 * TRACK_HEIGHT + SEPARATOR_HEIGHT);
  });
});

describe("régua", () => {
  it("rótulos curtos", () => {
    expect(rulerLabel(65_000_000, FPS30, false)).toBe("1:05");
    expect(rulerLabel(3_725_000_000, FPS30, false)).toBe("1:02:05");
    expect(rulerLabel(frameToUs(30 * 65 + 12, FPS30), FPS30, true)).toBe("1:05:12");
  });

  it("escolhe o menor intervalo com pelo menos 80 px entre rótulos", () => {
    const majors = (pps: number) => rulerTicks(vp(pps, 0, 2000), FPS30).filter((t) => t.major);
    // 40 px/s: 1 s = 40 px, 2 s = 80 px → principal a cada 2 s.
    const m40 = majors(40);
    expect(m40[1]!.t - m40[0]!.t).toBe(2_000_000);
    expect(m40[1]!.x - m40[0]!.x).toBe(80);
    // 2 px/s: 60 s = 120 px.
    const m2 = majors(2);
    expect(m2[1]!.t - m2[0]!.t).toBe(60_000_000);
    // 3000 px/s: 1 quadro = 100 px, rótulo com quadros.
    const m3000 = majors(3000);
    expect(m3000[1]!.t - m3000[0]!.t).toBe(33_333);
    expect(m3000[1]!.label).toBe("0:00:01");
  });

  it("marcas cobrem a área visível, com menores entre as principais", () => {
    const ticks = rulerTicks(vp(100, 1234, 800), FPS30);
    expect(ticks[0]!.x).toBeLessThanOrEqual(0);
    expect(ticks[ticks.length - 1]!.x).toBeGreaterThanOrEqual(800);
    expect(ticks.some((t) => !t.major)).toBe(true);
    expect(ticks.every((t) => Number.isInteger(t.t))).toBe(true);
    expect(ticks.filter((t) => t.major).every((t) => t.label)).toBe(true);
  });

  it("em 29,97 as marcas de quadro caem no início exato dos quadros", () => {
    const ticks = rulerTicks(vp(2500, 0, 1000), FPS2997);
    for (const tick of ticks) {
      const frame = Math.round((tick.t * 30000) / (1001 * 1_000_000));
      expect(tick.t).toBe(frameToUs(frame, FPS2997));
    }
  });
});
