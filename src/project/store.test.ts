import { describe, expect, it } from "vitest";
import { createProjectStore } from "./store";
import { makeSmallProject } from "./fixtures";
import { renameTrack, setTrackFlag } from "./commands/tracks";

describe("projectStore", () => {
  it("applyCommand altera o projeto e sobe a revisão", () => {
    const store = createProjectStore(makeSmallProject());
    const before = store.getState().project;
    store.getState().applyCommand("Renomear", renameTrack("t_v1", "A"));
    const s = store.getState();
    expect(s.project).not.toBe(before);
    expect(s.project.tracks[0]!.name).toBe("A");
    expect(s.revision).toBe(1);
    expect(s.canUndo()).toBe(true);
  });

  it("comando sem efeito não notifica nem muda a revisão", () => {
    const store = createProjectStore(makeSmallProject());
    let calls = 0;
    store.subscribe(() => calls++);
    store.getState().applyCommand("Nada", renameTrack("t_v1", "V1"));
    expect(calls).toBe(0);
    expect(store.getState().revision).toBe(0);
  });

  it("partes não alteradas mantêm a mesma referência (seletores não re-renderizam)", () => {
    const store = createProjectStore(makeSmallProject());
    const audioBefore = store.getState().project.tracks[1];
    store.getState().applyCommand("Mudo V1", setTrackFlag("t_v1", "muted", true));
    expect(store.getState().project.tracks[1]).toBe(audioBefore);
  });

  it("undo e redo passam pelo store", () => {
    const store = createProjectStore(makeSmallProject());
    const { applyCommand, undo, redo } = store.getState();
    applyCommand("a", renameTrack("t_v1", "A"));
    undo();
    expect(store.getState().project.tracks[0]!.name).toBe("V1");
    redo();
    expect(store.getState().project.tracks[0]!.name).toBe("A");
    expect(store.getState().revision).toBe(3);
  });

  it("load troca o projeto, zera o histórico e marca como salvo", () => {
    const store = createProjectStore(makeSmallProject());
    store.getState().applyCommand("a", renameTrack("t_v1", "A"));
    const other = makeSmallProject();
    other.name = "Outro";
    store.getState().load(other);
    const s = store.getState();
    expect(s.project.name).toBe("Outro");
    expect(s.canUndo()).toBe(false);
    expect(s.revision).toBe(s.savedRevision);
  });
});
