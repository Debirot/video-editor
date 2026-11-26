/**
 * Comandos sobre o projeto como um todo.
 */
import type { Recipe } from "../history";

/** Renomeia o projeto. Nome vazio (só espaços) é ignorado. */
export function renameProject(name: string): Recipe {
  return (draft) => {
    const trimmed = name.trim();
    if (trimmed) draft.name = trimmed;
  };
}
