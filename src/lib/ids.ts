import { customAlphabet } from "nanoid";

const ALPHABET = "0123456789abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ";
const nano = customAlphabet(ALPHABET, 8);

/**
 * Prefixos usados no projeto:
 * p = projeto, m = mídia, b = bin, t = trilha, c = clipe,
 * e = efeito, x = transição, k = marcador, g = grupo de ligação.
 */
export type IdPrefix = "p" | "m" | "b" | "t" | "c" | "e" | "x" | "k" | "g";

export function newId(prefix: IdPrefix): string {
  return `${prefix}_${nano()}`;
}
