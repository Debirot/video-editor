/**
 * Estado das mídias que depende da máquina e não vai para o project.json:
 * pôster gerado, se o WebCodecs decodifica, importações em andamento e erros.
 * Indexado pelo hash parcial do arquivo (o mesmo arquivo em dois projetos compartilha tudo).
 */
import { createStore } from "zustand/vanilla";
import { useStore } from "zustand";

export interface MediaRuntime {
  poster: "none" | "pending" | "ready" | "failed";
  posterUrl?: string;
  /** "n/a" para áudio e imagem; "unsupported" pede proxy. */
  decode: "n/a" | "checking" | "ok" | "unsupported";
  hardware?: boolean;
}

export interface ImportError {
  path: string;
  error: string;
}

interface RuntimeState {
  byHash: Record<string, MediaRuntime>;
  importing: number;
  errors: ImportError[];
  /** Arquivos sendo arrastados sobre a janela. */
  dragging: boolean;
}

export const runtimeStore = createStore<RuntimeState>()(() => ({
  byHash: {},
  importing: 0,
  errors: [],
  dragging: false,
}));

const EMPTY: MediaRuntime = { poster: "none", decode: "n/a" };

export function patchRuntime(hash: string, patch: Partial<MediaRuntime>): void {
  runtimeStore.setState((s) => ({ byHash: { ...s.byHash, [hash]: { ...EMPTY, ...s.byHash[hash], ...patch } } }));
}

export function useRuntime<T>(selector: (s: RuntimeState) => T): T {
  return useStore(runtimeStore, selector);
}

/** Tarefas em andamento: importações, pôsteres na fila e verificações de codec. */
export function pendingTasks(s: RuntimeState): number {
  let n = s.importing;
  for (const r of Object.values(s.byHash)) {
    if (r.poster === "pending") n++;
    if (r.decode === "checking") n++;
  }
  return n;
}
