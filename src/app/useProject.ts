import { useStore } from "zustand";
import { projectStore, type ProjectState } from "@/project/store";

/**
 * Lê um pedaço do store do projeto. Use seletores estreitos:
 * `useProject((s) => s.project.tracks)` re-renderiza só quando as trilhas mudam.
 */
export function useProject<T>(selector: (s: ProjectState) => T): T {
  return useStore(projectStore, selector);
}
