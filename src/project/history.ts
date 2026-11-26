/**
 * Histórico de desfazer baseado em patches do Immer.
 *
 * Toda alteração do projeto passa por `execute` (exposto como applyCommand no store).
 * Cada entrada guarda os patches de ida e de volta, então o custo de memória é
 * proporcional ao que mudou, não ao tamanho do projeto.
 *
 * Transações agrupam vários comandos numa única entrada (ex.: um arrasto na
 * timeline atualiza o projeto a cada movimento do mouse, mas vira um só passo
 * de desfazer ao soltar).
 *
 * Módulo estável: só mudar quando a tarefa pedir explicitamente.
 */
import { applyPatches, enablePatches, produceWithPatches, type Draft, type Patch } from "immer";
import type { Project } from "./types";

enablePatches();

/** Função que altera o rascunho do projeto. Não deve ter efeitos fora dele. */
export type Recipe = (draft: Draft<Project>) => void;

export interface HistoryEntry {
  label: string;
  patches: Patch[];
  inversePatches: Patch[];
}

export interface HistoryState {
  past: HistoryEntry[];
  future: HistoryEntry[];
  /** Transação aberta, ou null. */
  pending: HistoryEntry | null;
}

export interface Snapshot {
  project: Project;
  history: HistoryState;
}

export const emptyHistory = (): HistoryState => ({ past: [], future: [], pending: null });

/**
 * Aplica um comando. Comandos que não mudam nada não criam entrada.
 * Dentro de uma transação, os patches se acumulam na entrada pendente.
 */
export function execute(state: Snapshot, label: string, recipe: Recipe): Snapshot {
  const [project, patches, inversePatches] = produceWithPatches(state.project, recipe);
  if (patches.length === 0) return state;

  const { history } = state;
  if (history.pending) {
    const pending: HistoryEntry = {
      label: history.pending.label,
      patches: [...history.pending.patches, ...patches],
      // A volta desfaz o passo mais recente primeiro.
      inversePatches: [...inversePatches, ...history.pending.inversePatches],
    };
    return { project, history: { ...history, pending } };
  }

  return {
    project,
    history: {
      past: [...history.past, { label, patches, inversePatches }],
      future: [],
      pending: null,
    },
  };
}

export function beginTransaction(state: Snapshot, label: string): Snapshot {
  if (state.history.pending) {
    throw new Error(`Transação "${state.history.pending.label}" ainda aberta`);
  }
  return {
    project: state.project,
    history: { ...state.history, pending: { label, patches: [], inversePatches: [] } },
  };
}

/** Fecha a transação. Se nada mudou, não cria entrada. */
export function commitTransaction(state: Snapshot): Snapshot {
  const { pending } = state.history;
  if (!pending) return state;
  if (pending.patches.length === 0) {
    return { project: state.project, history: { ...state.history, pending: null } };
  }
  return {
    project: state.project,
    history: { past: [...state.history.past, pending], future: [], pending: null },
  };
}

/** Desfaz tudo que a transação aplicou e a descarta (ex.: Esc durante um arrasto). */
export function cancelTransaction(state: Snapshot): Snapshot {
  const { pending } = state.history;
  if (!pending) return state;
  return {
    project: applyPatches(state.project, pending.inversePatches),
    history: { ...state.history, pending: null },
  };
}

export function canUndo(history: HistoryState): boolean {
  return history.pending === null && history.past.length > 0;
}

export function canRedo(history: HistoryState): boolean {
  return history.pending === null && history.future.length > 0;
}

export function undo(state: Snapshot): Snapshot {
  if (!canUndo(state.history)) return state;
  const entry = state.history.past[state.history.past.length - 1]!;
  return {
    project: applyPatches(state.project, entry.inversePatches),
    history: {
      past: state.history.past.slice(0, -1),
      future: [entry, ...state.history.future],
      pending: null,
    },
  };
}

export function redo(state: Snapshot): Snapshot {
  if (!canRedo(state.history)) return state;
  const entry = state.history.future[0]!;
  return {
    project: applyPatches(state.project, entry.patches),
    history: {
      past: [...state.history.past, entry],
      future: state.history.future.slice(1),
      pending: null,
    },
  };
}
