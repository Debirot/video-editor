/**
 * Comandos sobre a lista de mídias do projeto.
 */
import type { Recipe } from "../history";
import type { Media } from "../types";

/** Mesmo arquivo = mesmo tamanho e mesmo hash parcial (independe do caminho). */
export function sameFile(a: Pick<Media, "fingerprint">, b: Pick<Media, "fingerprint">): boolean {
  return a.fingerprint.size === b.fingerprint.size && a.fingerprint.partialHash === b.fingerprint.partialHash;
}

/** Adiciona mídias, ignorando arquivos que o projeto já tem (ou repetidos na própria lista). */
export function addMedia(items: Media[]): Recipe {
  return (draft) => {
    for (const item of items) {
      if (draft.media.some((m) => sameFile(m, item))) continue;
      draft.media.push(structuredClone(item));
    }
  };
}
