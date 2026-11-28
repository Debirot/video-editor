import { describe, expect, it } from "vitest";
import { emptyHistory, execute, undo } from "../history";
import { makeClip, makeSmallProject } from "../fixtures";
import { DEFAULT_SHAPES } from "../normalize";
import { trackProblems } from "../queries";
import type { Project } from "../types";
import { addShapeClip, setClipShape, SHAPE_SIZE_MAX } from "./shapes";

const fps = { num: 30, den: 1 };
const state = (p: Project = makeSmallProject()) => ({ project: p, history: emptyHistory() });
const shapeOf = (p: Project, id: string) => p.tracks.flatMap((t) => t.clips).find((c) => c.id === id)!.shape!;
const trackOf = (p: Project, id: string) => p.tracks.find((t) => t.clips.some((c) => c.id === id))!;

describe("addShapeClip", () => {
  it("sem trilha de vídeo livre no trecho, cria uma acima das outras e põe a forma no playhead", () => {
    const s0 = state();
    const s1 = execute(s0, "Forma", addShapeClip("ellipse", 1_010_000, fps, "c_s"));
    const videos = s1.project.tracks.filter((t) => t.kind === "video");
    expect(videos.map((t) => t.name)).toEqual(["V1", "V2"]);
    const track = trackOf(s1.project, "c_s");
    expect(track.name).toBe("V2");
    // V1 continua intacta: a forma nunca sobrescreve vídeo.
    expect(s1.project.tracks[0]!.clips.map((c) => c.id)).toEqual(["c_1", "c_2", "c_3"]);
    expect(track.clips[0]).toMatchObject({ kind: "shape", start: 1_000_000, duration: 5_000_000, shape: DEFAULT_SHAPES.ellipse });
    expect(track.clips[0]!.mediaId).toBeUndefined();
    expect(trackProblems(track)).toEqual([]);
    expect(undo(s1).project).toEqual(s0.project);
  });

  it("usa a trilha de vídeo mais alta que esteja livre e destravada no trecho", () => {
    const p = makeSmallProject();
    const v2 = { ...structuredClone(p.tracks[0]!), id: "t_v2", name: "V2", clips: [] };
    const v3 = { ...structuredClone(p.tracks[0]!), id: "t_v3", name: "V3", locked: true, clips: [] };
    p.tracks.splice(1, 0, v2, v3);
    let s = execute(state(p), "Forma", addShapeClip("rect", 0, fps, "c_a"));
    expect(trackOf(s.project, "c_a").id).toBe("t_v2");
    // Ocupado em 0–5 s na V2: a segunda forma no mesmo trecho vai para uma trilha nova.
    s = execute(s, "Forma", addShapeClip("rect", 2_000_000, fps, "c_b"));
    expect(trackOf(s.project, "c_b").name).toBe("V4");
    // Depois do fim da primeira, a V2 está livre de novo.
    s = execute(s, "Forma", addShapeClip("line", 5_000_000, fps, "c_c"));
    expect(trackOf(s.project, "c_c").id).toBe("t_v2");
  });
});

describe("setClipShape", () => {
  const withShape = () => {
    const p = makeSmallProject();
    p.tracks[0]!.clips.push(makeClip({ id: "c_s", kind: "shape", mediaId: undefined, start: 9_000_000, duration: 1_000_000, shape: { ...DEFAULT_SHAPES.rect } }));
    return state(p);
  };

  it("muda tamanho, cores, contorno e cantos, e desfaz em um passo", () => {
    const s0 = withShape();
    const s1 = execute(s0, "Forma", setClipShape(["c_s"], { width: 300.4, height: 100, fill: "#00FF00", stroke: "#123abc", strokeWidth: 6, radius: 20 }));
    expect(shapeOf(s1.project, "c_s")).toEqual({ type: "rect", width: 300, height: 100, fill: "#00ff00", stroke: "#123abc", strokeWidth: 6, radius: 20 });
    expect(undo(s1).project).toEqual(s0.project);
  });

  it("limita valores: tamanho, espessura, cantos até metade do menor lado; cor inválida é ignorada", () => {
    let s = withShape();
    s = execute(s, "f", setClipShape(["c_s"], { width: 0, height: 99_999, strokeWidth: -3, fill: "vermelho", stroke: "#12" }));
    expect(shapeOf(s.project, "c_s")).toMatchObject({ width: 1, height: SHAPE_SIZE_MAX, strokeWidth: 0, fill: "#ffffff", stroke: "#000000" });
    s = execute(s, "f", setClipShape(["c_s"], { width: 200, height: 100, radius: 500 }));
    expect(shapeOf(s.project, "c_s").radius).toBe(50);
    // Diminuir o tamanho também puxa o raio.
    s = execute(s, "f", setClipShape(["c_s"], { height: 40 }));
    expect(shapeOf(s.project, "c_s").radius).toBe(20);
    s = execute(s, "f", setClipShape(["c_s"], { fill: "none" }));
    expect(shapeOf(s.project, "c_s").fill).toBe("none");
  });

  it("trocar o tipo mantém tamanho e cores; linha sem contorno ganha espessura", () => {
    let s = withShape();
    s = execute(s, "t", setClipShape(["c_s"], { type: "ellipse" }));
    expect(shapeOf(s.project, "c_s")).toMatchObject({ type: "ellipse", width: 640, height: 360, fill: "#ffffff" });
    s = execute(s, "t", setClipShape(["c_s"], { type: "line" }));
    expect(shapeOf(s.project, "c_s")).toMatchObject({ type: "line", strokeWidth: DEFAULT_SHAPES.line.strokeWidth });
  });

  it("ignora clipes que não são forma e trilhas travadas", () => {
    const s0 = withShape();
    expect(execute(s0, "f", setClipShape(["c_1"], { width: 10 }))).toBe(s0);
    const locked = execute(s0, "t", (d) => void (d.tracks[0]!.locked = true));
    expect(execute(locked, "f", setClipShape(["c_s"], { width: 10 }))).toBe(locked);
  });
});
