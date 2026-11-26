import { describe, expect, it } from "vitest";
import { emptyHistory, execute, undo } from "../history";
import { makeSmallProject } from "../fixtures";
import type { Media } from "../types";
import { addMedia, sameFile } from "./media";

function media(id: string, hash: string, size = 100, path = `/v/${id}.mp4`): Media {
  return {
    id,
    kind: "video",
    path,
    relPath: null,
    fingerprint: { size, mtime: 1, partialHash: hash },
    probe: { duration: 5_000_000, width: 1920, height: 1080 },
    proxy: { status: "none" },
    binId: null,
  };
}

describe("addMedia", () => {
  const start = () => ({ project: makeSmallProject(), history: emptyHistory() });

  it("adiciona em ordem e desfaz num passo só", () => {
    const s0 = start();
    const s1 = execute(s0, "Importar 2 mídias", addMedia([media("m_1", "h1"), media("m_2", "h2")]));
    expect(s1.project.media.map((m) => m.id)).toEqual(["m_a", "m_1", "m_2"]);
    expect(s1.history.past).toHaveLength(1);
    expect(undo(s1).project.media.map((m) => m.id)).toEqual(["m_a"]);
  });

  it("ignora arquivo que o projeto já tem, mesmo em outro caminho", () => {
    const s0 = start();
    const existing = s0.project.media[0]!;
    const copy = { ...media("m_x", existing.fingerprint.partialHash, existing.fingerprint.size), path: "/outra/pasta.mp4" };
    expect(execute(s0, "Importar", addMedia([copy]))).toBe(s0);
  });

  it("ignora repetidos dentro da mesma importação", () => {
    const s1 = execute(start(), "Importar", addMedia([media("m_1", "h1"), media("m_2", "h1")]));
    expect(s1.project.media.map((m) => m.id)).toEqual(["m_a", "m_1"]);
  });

  it("mesmo hash com tamanho diferente é outro arquivo", () => {
    expect(sameFile(media("a", "h", 1), media("b", "h", 2))).toBe(false);
    expect(sameFile(media("a", "h", 1), media("b", "h", 1))).toBe(true);
  });
});
