import { describe, expect, it } from "vitest";
import { emptyHistory, execute, undo } from "../history";
import { makeSmallProject } from "../fixtures";
import { renameProject } from "./project";

describe("renameProject", () => {
  const start = () => ({ project: makeSmallProject(), history: emptyHistory() });

  it("renomeia removendo espaços nas pontas, e desfaz", () => {
    const s1 = execute(start(), "Renomear projeto", renameProject("  Viagem a Morretes "));
    expect(s1.project.name).toBe("Viagem a Morretes");
    expect(undo(s1).project.name).toBe("Teste");
  });

  it("nome vazio ou igual não cria entrada no histórico", () => {
    const s0 = start();
    expect(execute(s0, "r", renameProject("   "))).toBe(s0);
    expect(execute(s0, "r", renameProject("Teste"))).toBe(s0);
  });
});
