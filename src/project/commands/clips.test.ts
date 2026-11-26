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
