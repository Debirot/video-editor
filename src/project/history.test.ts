import { describe, expect, it } from "vitest";
import {
  beginTransaction,
  cancelTransaction,
  canRedo,
  canUndo,
  commitTransaction,
  emptyHistory,
  execute,
  redo,
  undo,
  type Recipe,
  type Snapshot,
} from "./history";
import { addTrack, removeTrack, renameTrack, setTrackFlag, setTrackGain } from "./commands/tracks";
import { makeSmallProject } from "./fixtures";

const start = (): Snapshot => ({ project: makeSmallProject(), history: emptyHistory() });

const moveClip =
  (clipId: string, delta: number): Recipe =>
  (d) => {
    for (const t of d.tracks) {
      const c = t.clips.find((x) => x.id === clipId);
      if (c) c.start += delta;
    }
  };

describe("execute / undo / redo", () => {
  it("desfaz e refaz um comando", () => {
    const s0 = start();
    const s1 = execute(s0, "Renomear", renameTrack("t_v1", "Principal"));
    expect(s1.project.tracks[0]!.name).toBe("Principal");
    expect(s1.history.past).toHaveLength(1);

    const s2 = undo(s1);
    expect(s2.project).toEqual(s0.project);
    expect(canRedo(s2.history)).toBe(true);

    const s3 = redo(s2);
    expect(s3.project).toEqual(s1.project);
  });

  it("não cria entrada quando o comando não muda nada", () => {
    const s0 = start();
    const s1 = execute(s0, "Nada", renameTrack("t_v1", "V1"));
    expect(s1).toBe(s0);
    expect(execute(s0, "Inexistente", renameTrack("t_x", "?"))).toBe(s0);
  });

  it("novo comando apaga o futuro", () => {
    let s = start();
    s = execute(s, "a", setTrackFlag("t_v1", "muted", true));
    s = undo(s);
    expect(s.history.future).toHaveLength(1);
    s = execute(s, "b", setTrackFlag("t_v1", "locked", true));
    expect(s.history.future).toHaveLength(0);
    expect(canRedo(s.history)).toBe(false);
  });

  it("undo e redo sem histórico não fazem nada", () => {
    const s0 = start();
    expect(undo(s0)).toBe(s0);
    expect(redo(s0)).toBe(s0);
  });

  it("não altera o objeto original (imutabilidade)", () => {
    const s0 = start();
    const before = JSON.stringify(s0.project);
    execute(s0, "mover", moveClip("c_1", 500_000));
    expect(JSON.stringify(s0.project)).toBe(before);
  });

  it("50 comandos desfeitos voltam ao projeto inicial, e refeitos voltam ao final", () => {
    const s0 = start();
    let s = s0;
    const recipes: Array<[string, Recipe]> = [];
    for (let i = 0; i < 50; i++) {
      switch (i % 6) {
        case 0:
          recipes.push(["Adicionar trilha", addTrack(i % 12 === 0 ? "video" : "audio")]);
          break;
        case 1:
          recipes.push(["Mover", moveClip("c_3", 33_333)]);
          break;
        case 2:
          recipes.push(["Volume", setTrackGain("t_a1", -i / 5)]);
          break;
        case 3:
          recipes.push(["Mudo", setTrackFlag("t_a1", "muted", i % 2 === 1)]);
          break;
        case 4:
          recipes.push(["Renomear", renameTrack("t_v1", `V1 (${i})`)]);
          break;
        case 5:
          recipes.push([
            "Remover última trilha",
            (d) => {
              const last = d.tracks[d.tracks.length - 1]!;
              if (last.id !== "t_a1") removeTrack(last.id)(d);
              else last.solo = !last.solo;
            },
          ]);
          break;
      }
    }
    for (const [label, recipe] of recipes) s = execute(s, label, recipe);
    const final = s.project;
    expect(final).not.toEqual(s0.project);

    while (canUndo(s.history)) s = undo(s);
    expect(s.project).toEqual(s0.project);

    while (canRedo(s.history)) s = redo(s);
    expect(s.project).toEqual(final);
  });
});

describe("transações", () => {
  it("um arrasto com vários passos vira uma única entrada", () => {
    const s0 = start();
    let s = beginTransaction(s0, "Mover clipe");
    for (let i = 0; i < 10; i++) s = execute(s, "ignorado", moveClip("c_3", 100_000));
    expect(s.project.tracks[0]!.clips[2]!.start).toBe(7_000_000);
    expect(canUndo(s.history)).toBe(false); // transação aberta bloqueia undo

    s = commitTransaction(s);
    expect(s.history.past).toHaveLength(1);
    expect(s.history.past[0]!.label).toBe("Mover clipe");

    s = undo(s);
    expect(s.project).toEqual(s0.project);
    s = redo(s);
    expect(s.project.tracks[0]!.clips[2]!.start).toBe(7_000_000);
  });

  it("cancelar devolve o projeto ao estado anterior sem criar entrada", () => {
    const s0 = execute(start(), "a", renameTrack("t_v1", "X"));
    let s = beginTransaction(s0, "Arrasto");
    s = execute(s, "", moveClip("c_1", 1_000));
    s = execute(s, "", moveClip("c_1", 2_000));
    s = cancelTransaction(s);
    expect(s.project).toEqual(s0.project);
    expect(s.history.past).toHaveLength(1);
    expect(s.history.pending).toBeNull();
  });

  it("transação sem mudanças não cria entrada", () => {
    const s0 = start();
    const s = commitTransaction(beginTransaction(s0, "Clique sem arrastar"));
    expect(s.history.past).toHaveLength(0);
    expect(s.history.pending).toBeNull();
  });

  it("não permite abrir duas transações", () => {
    const s = beginTransaction(start(), "a");
    expect(() => beginTransaction(s, "b")).toThrow();
  });
});
