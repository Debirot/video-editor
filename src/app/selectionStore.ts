/**
 * Clipes selecionados e área de transferência. Estado de tela: não entra no
 * project.json nem no histórico de desfazer. Ids que deixaram de existir (por
 * exemplo depois de desfazer) são ignorados por quem lê (liveSelection).
 */
import { createStore } from "zustand/vanilla";
import { useStore } from "zustand";
import { withLinked } from "@/project/queries";
import { projectStore } from "@/project/store";
import type { ClipboardEntry } from "@/project/commands/clips";
import type { Id } from "@/project/types";

interface SelectionState {
  clipIds: Id[];
  clipboard: ClipboardEntry[];
}

export const selectionStore = createStore<SelectionState>()(() => ({ clipIds: [], clipboard: [] }));

export function useSelection<T>(selector: (s: SelectionState) => T): T {
  return useStore(selectionStore, selector);
}

/** Seleção atual, só com clipes que ainda existem. */
export function liveSelection(): Id[] {
  const project = projectStore.getState().project;
  const existing = new Set(project.tracks.flatMap((t) => t.clips.map((c) => c.id)));
  return selectionStore.getState().clipIds.filter((id) => existing.has(id));
}

/**
 * Clique num clipe: seleciona ele e os ligados. Com `additive` (Ctrl+clique),
 * alterna esse grupo sem mexer no resto. Clique fora (id null) limpa, salvo com Ctrl.
 */
export function selectClip(id: Id | null, additive: boolean): void {
  const project = projectStore.getState().project;
  if (id === null) {
    if (!additive) selectionStore.setState({ clipIds: [] });
    return;
  }
  const group = withLinked(project, [id]);
  if (!additive) {
    selectionStore.setState({ clipIds: group });
    return;
  }
  const current = new Set(liveSelection());
  const allSelected = group.every((g) => current.has(g));
  for (const g of group) {
    if (allSelected) current.delete(g);
    else current.add(g);
  }
  selectionStore.setState({ clipIds: [...current] });
}

export function setSelection(ids: Id[]): void {
  selectionStore.setState({ clipIds: ids });
}
