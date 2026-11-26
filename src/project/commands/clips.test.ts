import { describe, expect, it } from "vitest";
import { frameToUs } from "@/lib/time";
import { emptyHistory, execute, redo, undo, type Snapshot } from "../history";
import { createProject } from "../normalize";
import { trackProblems } from "../queries";
import type { Media, Project } from "../types";
import { appendMediaClip } from "./clips";

const FPS30 = { num: 30, den: 1 };
const FPS2997 = { num: 30000, den: 1001 };

function media(partial: Partial<Media> & Pick<Media, "id" | "kind">): Media {
  return {
    path: `/v/${partial.id}`,
    relPath: null,
    fingerprint: { size: 1, mtime: 1, partialHash: partial.id },
    probe: { duration: 10_000_000 },
    proxy: { status: "none" },
    binId: null,
    ...partial,
  };
}

const withAudio = media({ id: "m_v", kind: "video", probe: { duration: 10_000_000, audioCodec: "aac" } });
const silent = media({ id: "m_s", kind: "video", probe: { duration: 4_000_000 } });
const song = media({ id: "m_a", kind: "audio", probe: { duration: 30_000_000, audioCodec: "mp3" } });
const logo = media({ id: "m_i", kind: "image", probe: { duration: 0 } });

const start = (): Snapshot => ({ project: createProject("T"), history: emptyHistory() });
const v1 = (p: Project) => p.tracks.find((t) => t.name === "V1")!;
const a1 = (p: Project) => p.tracks.find((t) => t.name === "A1")!;
const append = (s: Snapshot, m: Media, fps = FPS30) => execute(s, "Adicionar à timeline", appendMediaClip(m, fps));

describe("appendMediaClip", () => {
  it("vídeo com áudio vira dois clipes ligados em V1 e A1", () => {
    const s = append(start(), withAudio);
    const [v] = v1(s.project).clips;
    const [a] = a1(s.project).clips;
    expect(v).toMatchObject({ start: 0, duration: 10_000_000, mediaId: "m_v", sourceIn: 0, speed: 1 });
    expect(a).toMatchObject({ start: 0, duration: 10_000_000, mediaId: "m_v", audio: { gainDb: 0 } });
    expect(v!.linkGroup).toBeDefined();
    expect(v!.linkGroup).toBe(a!.linkGroup);
    expect(v!.id).not.toBe(a!.id);
  });

  it("o segundo entra logo depois do primeiro", () => {
    const s = append(append(start(), withAudio), silent);
    expect(v1(s.project).clips.map((c) => [c.start, c.duration])).toEqual([
      [0, 10_000_000],
      [10_000_000, 4_000_000],
    ]);
    expect(a1(s.project).clips).toHaveLength(1);
    expect(v1(s.project).clips[1]!.linkGroup).toBeUndefined();
  });

  it("clipes ligados começam no maior dos dois fins (sem sobrepor)", () => {
    const s = append(append(start(), song), withAudio); // A1 vai até 30 s, V1 vazia
    expect(v1(s.project).clips[0]!.start).toBe(30_000_000);
    expect(a1(s.project).clips[1]!.start).toBe(30_000_000);
    expect(s.project.tracks.every((t) => trackProblems(t).length === 0)).toBe(true);
  });

  it("áudio vai só para A1; imagem fica 5 s em V1", () => {
    const s = append(append(start(), song), logo);
    expect(a1(s.project).clips.map((c) => c.mediaId)).toEqual(["m_a"]);
    expect(v1(s.project).clips[0]).toMatchObject({ mediaId: "m_i", start: 0, duration: 5_000_000 });
  });

  it("duração arredonda para baixo ao quadro do projeto (29,97)", () => {
    const s = append(start(), media({ id: "m_x", kind: "video", probe: { duration: 1_000_000 } }), FPS2997);
    const clip = v1(s.project).clips[0]!;
    expect(clip.duration).toBe(frameToUs(29, FPS2997)); // 29,97 quadros → 29
    const s2 = append(s, media({ id: "m_y", kind: "video", probe: { duration: 1_000_000 } }), FPS2997);
    expect(v1(s2.project).clips[1]!.start).toBe(frameToUs(29, FPS2997));
  });

  it("pula trilha travada e não faz nada se não houver trilha livre", () => {
    let s = start();
    const lockAll = (kind: "video" | "audio") => (d: Project) => d.tracks.forEach((t) => t.kind === kind && (t.locked = true));
    s = execute(s, "travar", (d) => void lockAll("video")(d as Project));
    expect(append(s, silent)).toBe(s);
    expect(append(s, withAudio)).toBe(s); // sem vídeo livre, não coloca só o áudio
    expect(a1(append(s, song).project).clips).toHaveLength(1);
  });

  it("mídia curta demais (menos de 1 quadro) é ignorada", () => {
    const s = start();
    expect(append(s, media({ id: "m_z", kind: "video", probe: { duration: 10_000 } }))).toBe(s);
  });

  it("desfaz em um passo e refaz com os mesmos ids", () => {
    const s0 = start();
    const s1 = append(s0, withAudio);
    expect(undo(s1).project).toEqual(s0.project);
    expect(redo(undo(s1)).project).toEqual(s1.project);
  });
});

// ─── T1.06a ──────────────────────────────────────────────────────────────────
import { makeClip, makeSmallProject } from "../fixtures";
import { clipAt, nextCut, withLinked } from "../queries";
import { clearRange, copyClips, cutClip, deleteClips, pasteClips, splitClips } from "./clips";
import type { Track } from "../types";

const small = (): Snapshot => ({ project: makeSmallProject(), history: emptyHistory() });
const track = (p: Project, id = "t_v1") => p.tracks.find((t) => t.id === id)!;
const spans = (t: Track) => t.clips.map((c) => [c.id, c.start, c.duration, c.sourceIn]);
const valid = (p: Project) => p.tracks.every((t) => trackProblems(t).length === 0);

/** V1: c_1 0–2 s; c_2 2–5 s (fonte a partir de 10 s); c_3 6–8 s com speed 2. A1 com c_a ligado a c_2. */
function linkedProject(): Snapshot {
  const s = small();
  const p = structuredClone(s.project);
  p.tracks[0]!.clips[1]!.linkGroup = "g_1";
  p.tracks[1]!.clips.push(
    makeClip({ id: "c_a", start: 2_000_000, duration: 3_000_000, sourceIn: 10_000_000, linkGroup: "g_1", audio: { gainDb: 0, fadeIn: 500_000, fadeOut: 400_000 } }),
  );
  return { project: p, history: emptyHistory() };
}

describe("cutClip", () => {
  it("corta no meio e avança a fonte; speed 2 avança o dobro", () => {
    const [l, r] = cutClip(makeClip({ id: "c", start: 1_000_000, duration: 4_000_000, sourceIn: 500_000, speed: 2 }), 2_000_000, "c_r");
    expect([l.start, l.duration, l.sourceIn]).toEqual([1_000_000, 1_000_000, 500_000]);
    expect([r.id, r.start, r.duration, r.sourceIn]).toEqual(["c_r", 2_000_000, 3_000_000, 2_500_000]);
  });

  it("keyframes vão para a metade certa, relativos ao novo início", () => {
    const clip = makeClip({
      id: "c", start: 0, duration: 4_000_000,
      keyframes: { "transform.opacity": [{ t: 0, v: 0, ease: "linear" }, { t: 1_000_000, v: 1, ease: "linear" }, { t: 3_000_000, v: 0.5, ease: "linear" }] },
    });
    const [l, r] = cutClip(clip, 2_000_000, "r");
    expect(l.keyframes["transform.opacity"]!.map((k) => k.t)).toEqual([0, 1_000_000]);
    expect(r.keyframes["transform.opacity"]!.map((k) => k.t)).toEqual([1_000_000]);
  });

  it("freeze mantém o mesmo quadro nas duas metades", () => {
    const [, r] = cutClip(makeClip({ id: "f", kind: "freeze", start: 0, duration: 2_000_000, sourceIn: 777 }), 1_000_000, "r");
    expect(r.sourceIn).toBe(777);
  });
});

describe("splitClips", () => {
  it("divide no meio, a direita ganha o id pedido", () => {
    const s = execute(small(), "Dividir", splitClips(["c_2"], 3_000_000, { c_2: "c_2b" }));
    expect(spans(track(s.project))).toEqual([
      ["c_1", 0, 2_000_000, 0],
      ["c_2", 2_000_000, 1_000_000, 10_000_000],
      ["c_2b", 3_000_000, 2_000_000, 11_000_000],
      ["c_3", 6_000_000, 2_000_000, 0],
    ]);
    expect(valid(s.project)).toBe(true);
  });

  it("na borda do clipe não faz nada", () => {
    const s0 = small();
    expect(execute(s0, "Dividir", splitClips(["c_2"], 2_000_000, {}))).toBe(s0);
    expect(execute(s0, "Dividir", splitClips(["c_2"], 5_000_000, {}))).toBe(s0);
  });

  it("clipe com speed 2: a fonte da direita avança o dobro", () => {
    const s = execute(small(), "Dividir", splitClips(["c_3"], 7_000_000, { c_3: "c_3b" }));
    expect(track(s.project).clips.find((c) => c.id === "c_3b")!.sourceIn).toBe(2_000_000);
  });

  it("clipe ligado: divide os dois e as metades da direita continuam ligadas entre si", () => {
    const s0 = linkedProject();
    const ids = withLinked(s0.project, ["c_2"]);
    expect(ids.sort()).toEqual(["c_2", "c_a"]);
    const s = execute(s0, "Dividir", splitClips(ids, 3_000_000, { c_2: "v_r", c_a: "a_r" }));
    const vr = track(s.project).clips.find((c) => c.id === "v_r")!;
    const ar = track(s.project, "t_a1").clips.find((c) => c.id === "a_r")!;
    const al = track(s.project, "t_a1").clips.find((c) => c.id === "c_a")!;
    expect(vr.linkGroup).toBe(ar.linkGroup);
    expect(vr.linkGroup).not.toBe("g_1");
    expect(al.linkGroup).toBe("g_1");
    expect([al.audio!.fadeIn, al.audio!.fadeOut, ar.audio!.fadeIn, ar.audio!.fadeOut]).toEqual([500_000, 0, 0, 400_000]);
  });

  it("Ctrl+Z desfaz a divisão em um passo", () => {
    const s0 = linkedProject();
    const s = execute(s0, "Dividir", splitClips(["c_2", "c_a"], 3_000_000, {}));
    expect(undo(s).project).toEqual(s0.project);
  });

  it("trilha travada não divide", () => {
    const s0 = execute(small(), "travar", (d) => void (d.tracks[0]!.locked = true));
    expect(execute(s0, "Dividir", splitClips(["c_2"], 3_000_000, {}))).toBe(s0);
  });
});

describe("deleteClips", () => {
  it("apaga deixando o espaço", () => {
    const s = execute(small(), "Apagar", deleteClips(["c_2"]));
    expect(spans(track(s.project)).map((x) => [x[0], x[1]])).toEqual([["c_1", 0], ["c_3", 6_000_000]]);
  });

  it("ripple fecha o espaço só na trilha afetada", () => {
    const s0 = linkedProject();
    s0.project.tracks[1]!.clips.push(makeClip({ id: "c_b", start: 9_000_000, duration: 1_000_000 }));
    const s = execute(s0, "Apagar fechando", deleteClips(["c_1"], true));
    expect(spans(track(s.project)).map((x) => [x[0], x[1]])).toEqual([["c_2", 0], ["c_3", 4_000_000]]);
    // A1 não teve nada apagado: não se move.
    expect(track(s.project, "t_a1").clips.map((c) => c.start)).toEqual([2_000_000, 9_000_000]);
    expect(valid(s.project)).toBe(true);
  });

  it("ripple com dois apagados na mesma trilha soma os deslocamentos", () => {
    const s = execute(small(), "Apagar", deleteClips(["c_1", "c_2"], true));
    expect(track(s.project).clips.map((c) => [c.id, c.start])).toEqual([["c_3", 1_000_000]]);
  });

  it("remove transições que apontavam para o clipe apagado", () => {
    const s0 = small();
    s0.project.tracks[0]!.transitions.push({ id: "x_1", type: "dissolve", fromClipId: "c_1", toClipId: "c_2", duration: 500_000 });
    const s = execute(s0, "Apagar", deleteClips(["c_2"]));
    expect(track(s.project).transitions).toEqual([]);
  });
});

describe("clearRange", () => {
  const run = (from: number, to: number) => {
    const t = structuredClone(track(makeSmallProject()));
    let n = 0;
    clearRange(t, from, to, () => `novo_${++n}`);
    expect(trackProblems(t)).toEqual([]);
    return spans(t);
  };

  it("intervalo vazio não muda nada", () => {
    expect(run(5_000_000, 6_000_000)).toEqual(spans(track(makeSmallProject())));
  });

  it("remove o que está dentro e apara as pontas", () => {
    expect(run(1_000_000, 6_500_000)).toEqual([
      ["c_1", 0, 1_000_000, 0],
      ["c_3", 6_500_000, 1_500_000, 1_000_000], // speed 2: 0,5 s de timeline = 1 s de fonte
    ]);
  });

  it("intervalo no meio de um clipe corta em dois", () => {
    expect(run(3_000_000, 4_000_000)).toEqual([
      ["c_1", 0, 2_000_000, 0],
      ["c_2", 2_000_000, 1_000_000, 10_000_000],
      ["novo_1", 4_000_000, 1_000_000, 12_000_000],
      ["c_3", 6_000_000, 2_000_000, 0],
    ]);
  });
});

describe("copyClips / pasteClips", () => {
  it("cola no playhead mantendo distâncias e trilhas, sobrescrevendo o caminho", () => {
    const s0 = linkedProject();
    const clip = copyClips(s0.project, withLinked(s0.project, ["c_2"]));
    expect(clip.map((e) => e.trackId).sort()).toEqual(["t_a1", "t_v1"]);
    const s = execute(s0, "Colar", pasteClips(clip, 6_000_000, ["p_1", "p_2"]));
    const v = track(s.project);
    expect(v.clips.map((c) => [c.id, c.start, c.duration])).toEqual([
      ["c_1", 0, 2_000_000],
      ["c_2", 2_000_000, 3_000_000],
      [expect.stringMatching(/^p_/), 6_000_000, 3_000_000], // c_3 (6–8 s) foi sobrescrito
    ]);
    const pastedV = v.clips[2]!;
    const pastedA = track(s.project, "t_a1").clips.find((c) => c.start === 6_000_000)!;
    expect(pastedV.linkGroup).toBe(pastedA.linkGroup);
    expect(pastedV.linkGroup).not.toBe("g_1");
    expect(valid(s.project)).toBe(true);
    expect(undo(s).project).toEqual(s0.project);
  });

  it("trilha travada ou removida é pulada", () => {
    const s0 = small();
    const entries = copyClips(s0.project, ["c_1"]);
    const locked = execute(s0, "travar", (d) => void (d.tracks[0]!.locked = true));
    expect(execute(locked, "Colar", pasteClips(entries, 10_000_000, ["x"]))).toBe(locked);
    expect(execute(s0, "Colar", pasteClips([{ ...entries[0]!, trackId: "t_sumiu" }], 0, ["x"]))).toBe(s0);
  });

  it("duplicar = colar logo depois do fim da seleção", () => {
    const s0 = small();
    const entries = copyClips(s0.project, ["c_1", "c_2"]);
    const s = execute(s0, "Duplicar", pasteClips(entries, 5_000_000, ["d_1", "d_2"]));
    expect(track(s.project).clips.map((c) => [c.id, c.start, c.duration])).toEqual([
      ["c_1", 0, 2_000_000],
      ["c_2", 2_000_000, 3_000_000],
      ["d_1", 5_000_000, 2_000_000],
      ["d_2", 7_000_000, 3_000_000],
    ]);
  });
});

describe("withLinked / nextCut", () => {
  it("withLinked ignora ids que não existem", () => {
    expect(withLinked(makeSmallProject(), ["c_1", "c_zz"])).toEqual(["c_1"]);
  });

  it("nextCut anda pelos inícios e fins de clipes", () => {
    const p = makeSmallProject();
    expect(nextCut(p, 0, 1)).toBe(2_000_000);
    expect(nextCut(p, 5_500_000, 1)).toBe(6_000_000);
    expect(nextCut(p, 5_500_000, -1)).toBe(5_000_000);
    expect(nextCut(p, 8_000_000, 1)).toBeUndefined();
    expect(nextCut(p, 0, -1)).toBeUndefined();
    expect(clipAt(track(p), 3_000_000)?.id).toBe("c_2");
  });
});

// ─── T1.06b ──────────────────────────────────────────────────────────────────
import { insertMediaAt, moveClips, trimBounds, trimClips } from "./clips";

/** Projeto com V1, V2, A1 (cria V2 vazia acima de V1). */
function withV2(s: Snapshot): Snapshot {
  const p = structuredClone(s.project);
  p.tracks.splice(1, 0, { ...structuredClone(p.tracks[0]!), id: "t_v2", name: "V2", clips: [], transitions: [] });
  return { project: p, history: emptyHistory() };
}

describe("moveClips", () => {
  it("move no tempo sobrescrevendo o destino", () => {
    const s = execute(small(), "Mover", moveClips(["c_1"], 5_000_000, null));
    // c_1 (0–2 s) vai para 5–7 s: corta o fim de c_2? não, c_2 vai até 5 s; corta o começo de c_3 (6–8 s).
    expect(spans(track(s.project)).map((x) => [x[0], x[1], x[2]])).toEqual([
      ["c_2", 2_000_000, 3_000_000],
      ["c_1", 5_000_000, 2_000_000],
      ["c_3", 7_000_000, 1_000_000],
    ]);
    expect(track(s.project).clips[2]!.sourceIn).toBe(2_000_000); // speed 2: 1 s de timeline = 2 s de fonte
    expect(valid(s.project)).toBe(true);
  });

  it("move entre trilhas de vídeo; o áudio ligado só anda no tempo", () => {
    const s0 = withV2(linkedProject());
    const s = execute(s0, "Mover", moveClips(["c_2", "c_a"], 1_000_000, { kind: "video", by: 1 }));
    expect(track(s.project, "t_v2").clips.map((c) => [c.id, c.start])).toEqual([["c_2", 3_000_000]]);
    expect(track(s.project).clips.map((c) => c.id)).toEqual(["c_1", "c_3"]);
    expect(track(s.project, "t_a1").clips.map((c) => [c.id, c.start])).toEqual([["c_a", 3_000_000]]);
    expect(undo(s).project).toEqual(s0.project);
  });

  it("não move para antes do zero, para trilha inexistente ou travada", () => {
    const s0 = withV2(small());
    expect(execute(s0, "Mover", moveClips(["c_1"], -1, null))).toBe(s0);
    expect(execute(s0, "Mover", moveClips(["c_1"], 0, { kind: "video", by: 5 }))).toBe(s0);
    const locked = execute(s0, "travar", (d) => void (d.tracks.find((t) => t.id === "t_v2")!.locked = true));
    expect(execute(locked, "Mover", moveClips(["c_1"], 0, { kind: "video", by: 1 }))).toBe(locked);
  });

  it("mover vários mantém a distância entre eles e não se sobrescrevem", () => {
    const s = execute(small(), "Mover", moveClips(["c_1", "c_2"], 10_000_000, null));
    expect(spans(track(s.project)).map((x) => [x[0], x[1]])).toEqual([
      ["c_3", 6_000_000],
      ["c_1", 10_000_000],
      ["c_2", 12_000_000],
    ]);
  });

  it("deslocamento zero sem trocar de trilha não cria entrada", () => {
    const s0 = small();
    expect(execute(s0, "Mover", moveClips(["c_1"], 0, null))).toBe(s0);
  });
});

describe("trimBounds / trimClips", () => {
  const frame = frameToUs(1, FPS30);

  it("fim: entre 1 quadro e o próximo clipe (ou o fim da mídia)", () => {
    const p = makeSmallProject(); // mídia de 60 s
    expect(trimBounds(p, ["c_1"], "end", FPS30)).toEqual([frame, 2_000_000]); // c_2 encostado
    expect(trimBounds(p, ["c_2"], "end", FPS30)).toEqual([2_000_000 + frame, 6_000_000]);
    // c_3: speed 2, sourceIn 0 → mídia acaba em 6 s + 60/2 s; não há próximo.
    expect(trimBounds(p, ["c_3"], "end", FPS30)).toEqual([6_000_000 + frame, 36_000_000]);
  });

  it("início: depois do anterior e sem passar do começo da mídia", () => {
    const p = makeSmallProject();
    // c_2 tem sourceIn 10 s: poderia ir até -8 s, mas o c_1 termina em 2 s.
    expect(trimBounds(p, ["c_2"], "start", FPS30)).toEqual([2_000_000, 5_000_000 - frame]);
    // c_3 começa em 6 s com sourceIn 0: não dá para puxar o início para trás.
    expect(trimBounds(p, ["c_3"], "start", FPS30)).toEqual([6_000_000, 8_000_000 - frame]);
  });

  it("aparar o início move a fonte junto; o fim só a duração", () => {
    let s = execute(small(), "Aparar", trimClips(["c_2"], "start", 3_000_000));
    expect(spans(track(s.project))[1]).toEqual(["c_2", 3_000_000, 2_000_000, 11_000_000]);
    s = execute(s, "Aparar", trimClips(["c_2"], "end", 5_500_000));
    expect(spans(track(s.project))[1]).toEqual(["c_2", 3_000_000, 2_500_000, 11_000_000]);
    expect(valid(s.project)).toBe(true);
  });

  it("clipes ligados aparam juntos, com o limite mais apertado", () => {
    const s0 = linkedProject();
    const b = trimBounds(s0.project, ["c_2", "c_a"], "end", FPS30)!;
    expect(b[1]).toBe(6_000_000); // c_3 em V1 limita; A1 está livre
    const s = execute(s0, "Aparar", trimClips(["c_2", "c_a"], "end", 4_000_000));
    expect(track(s.project).clips[1]!.duration).toBe(2_000_000);
    expect(track(s.project, "t_a1").clips[0]!.duration).toBe(2_000_000);
    expect(track(s.project, "t_a1").clips[0]!.audio!.fadeOut).toBe(400_000);
  });
});

describe("insertMediaAt", () => {
  it("solta no ponto e na trilha escolhida, sobrescrevendo", () => {
    const s0 = withV2(start());
    const s = execute(s0, "Inserir", insertMediaAt(withAudio, FPS30, 3_000_000, "t_v2"));
    expect(track(s.project, "t_v2").clips.map((c) => [c.start, c.duration])).toEqual([[3_000_000, 10_000_000]]);
    // O áudio vai para a primeira trilha de áudio livre (A1), ligado ao vídeo.
    const a = a1(s.project).clips[0]!;
    expect([a.start, a.linkGroup]).toEqual([3_000_000, track(s.project, "t_v2").clips[0]!.linkGroup]);
  });

  it("soltar vídeo numa trilha de áudio põe o áudio ali e o vídeo na V1", () => {
    const s0 = start();
    const a2 = s0.project.tracks.find((t) => t.name === "A2")!.id;
    const s = execute(s0, "Inserir", insertMediaAt(withAudio, FPS30, 0, a2));
    expect(track(s.project, a2).clips).toHaveLength(1);
    expect(v1(s.project).clips).toHaveLength(1);
  });

  it("sobrescreve o meio de um clipe existente", () => {
    const s0 = append(start(), silent); // V1: 0–4 s
    const shortClip = media({ id: "m_c", kind: "video", probe: { duration: 1_000_000 } });
    const s = execute(s0, "Inserir", insertMediaAt(shortClip, FPS30, 1_000_000, null));
    expect(v1(s.project).clips.map((c) => [c.mediaId, c.start, c.duration])).toEqual([
      ["m_s", 0, 1_000_000],
      ["m_c", 1_000_000, 1_000_000],
      ["m_s", 2_000_000, 2_000_000],
    ]);
  });
});
