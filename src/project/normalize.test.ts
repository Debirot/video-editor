import { describe, expect, it } from "vitest";
import { createProject, normalizeProject, ProjectFormatError, serializeProject } from "./normalize";
import { makeSmallProject } from "./fixtures";
import { trackProblems } from "./queries";

describe("normalizeProject", () => {
  it("ida e volta por JSON preserva o projeto", () => {
    const p = makeSmallProject();
    expect(normalizeProject(JSON.parse(serializeProject(p)))).toEqual(p);
  });

  it("preenche valores padrão omitidos", () => {
    const p = normalizeProject({
      schemaVersion: 1,
      id: "p_1",
      name: "Mínimo",
      tracks: [{ id: "t_1", kind: "video", clips: [{ id: "c_1", mediaId: "m_1", start: 0, duration: 1_000_000 }] }],
    });
    const clip = p.tracks[0]!.clips[0]!;
    expect(clip.speed).toBe(1);
    expect(clip.enabled).toBe(true);
    expect(clip.transform).toEqual({ x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 });
    expect(clip.keyframes).toEqual({});
    expect(p.settings.fps).toEqual({ num: 30, den: 1 });
    expect(p.media).toEqual([]);
    expect(p.tracks[0]!.muted).toBe(false);
  });

  it("ordena clipes por start", () => {
    const p = normalizeProject({
      schemaVersion: 1,
      id: "p_1",
      tracks: [
        {
          id: "t_1",
          kind: "video",
          clips: [
            { id: "c_2", start: 5_000_000, duration: 1_000_000 },
            { id: "c_1", start: 0, duration: 1_000_000 },
          ],
        },
      ],
    });
    expect(p.tracks[0]!.clips.map((c) => c.id)).toEqual(["c_1", "c_2"]);
  });

  it("não grava o campo calculado missing", () => {
    const p = makeSmallProject();
    p.media[0]!.missing = true;
    const json = JSON.parse(serializeProject(p));
    expect(json.media[0]).not.toHaveProperty("missing");
    expect(p.media[0]!.missing).toBe(true);
  });

  it.each([
    [null, "não é objeto"],
    [{ id: "p" }, "sem schemaVersion"],
    [{ schemaVersion: 1 }, "sem id"],
    [{ schemaVersion: 1, id: "p", tracks: [{ id: "t", kind: "foo" }] }, "tipo de trilha inválido"],
    [{ schemaVersion: 1, id: "p", tracks: [{ id: "t", kind: "video", clips: [{ id: "c", start: 0.5, duration: 1 }] }] }, "tempo não inteiro"],
    [{ schemaVersion: 1, id: "p", settings: { fps: { num: 29.97, den: 1 } } }, "FPS não racional"],
  ])("recusa %j (%s)", (raw, _why) => {
    expect(() => normalizeProject(raw)).toThrow(ProjectFormatError);
  });

  it("recusa projeto de versão mais nova com mensagem clara", () => {
    expect(() => normalizeProject({ schemaVersion: 99, id: "p" })).toThrow(/versão mais nova/);
  });
});

describe("createProject", () => {
  it("cria duas trilhas de vídeo e duas de áudio, válidas", () => {
    const p = createProject("Novo", { width: 1080, height: 1920 });
    expect(p.tracks.map((t) => t.name)).toEqual(["V1", "V2", "A1", "A2"]);
    expect(p.settings.width).toBe(1080);
    expect(p.tracks.every((t) => trackProblems(t).length === 0)).toBe(true);
    expect(new Set(p.tracks.map((t) => t.id)).size).toBe(4);
  });
});
