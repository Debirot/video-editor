/**
 * Store do projeto (Zustand vanilla, sem React).
 *
 * É o único lugar que guarda o projeto aberto. Componentes leem com
 * `useProject(selector)` (src/app/useProject.ts) e alteram só por `applyCommand`.
 */
import { createStore } from "zustand/vanilla";
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
  type HistoryState,
  type Recipe,
  type Snapshot,
} from "./history";
import { createProject } from "./normalize";
import type { Project } from "./types";

export interface ProjectState {
  project: Project;
  history: HistoryState;
  /** Sobe a cada mudança do projeto. O Worker usa para saber se precisa recompor. */
  revision: number;
  /** Revisão gravada em disco por último. revision !== savedRevision → há alterações. */
  savedRevision: number;

  applyCommand: (label: string, recipe: Recipe) => void;
  beginTransaction: (label: string) => void;
  commitTransaction: () => void;
  cancelTransaction: () => void;
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
  /** Troca o projeto aberto e zera o histórico. */
  load: (project: Project) => void;
  markSaved: () => void;
}

export function createProjectStore(initial: Project = createProject("Sem título")) {
  return createStore<ProjectState>()((set, get) => {
    /** Aplica uma transição pura do histórico e sobe a revisão se o projeto mudou. */
    const step = (fn: (s: Snapshot) => Snapshot) => {
      const { project, history, revision } = get();
      const next = fn({ project, history });
      if (next.project === project && next.history === history) return;
      set({
        project: next.project,
        history: next.history,
        revision: next.project === project ? revision : revision + 1,
      });
    };

    return {
      project: initial,
      history: emptyHistory(),
      revision: 0,
      savedRevision: 0,

      applyCommand: (label, recipe) => step((s) => execute(s, label, recipe)),
      beginTransaction: (label) => step((s) => beginTransaction(s, label)),
      commitTransaction: () => step(commitTransaction),
      cancelTransaction: () => step(cancelTransaction),
      undo: () => step(undo),
      redo: () => step(redo),
      canUndo: () => canUndo(get().history),
      canRedo: () => canRedo(get().history),
      load: (project) =>
        set((s) => ({ project, history: emptyHistory(), revision: s.revision + 1, savedRevision: s.revision + 1 })),
      markSaved: () => set((s) => ({ savedRevision: s.revision })),
    };
  });
}

export type ProjectStore = ReturnType<typeof createProjectStore>;

/** Store único do app. Testes criam o seu com createProjectStore(). */
export const projectStore = createProjectStore();
