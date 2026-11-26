/**
 * Caminhos de arquivo em texto puro (sem Node nem Tauri), para Windows e Unix.
 * Usados para gravar `relPath` das mídias em relação à pasta do projeto.
 */

const isWindowsPath = (p: string) => /^[a-zA-Z]:[\\/]/.test(p) || p.startsWith("\\\\");

function parts(p: string): string[] {
  return p.split(/[\\/]+/).filter((s) => s.length > 0 && s !== ".");
}

/** Caminho de `to` relativo à pasta `fromDir`, com "/". null se estiverem em discos diferentes. */
export function relativePath(fromDir: string, to: string): string | null {
  const win = isWindowsPath(fromDir) || isWindowsPath(to);
  const a = parts(fromDir);
  const b = parts(to);
  const same = (x: string, y: string) => (win ? x.toLowerCase() === y.toLowerCase() : x === y);
  if (win && (!a[0] || !b[0] || !same(a[0], b[0]))) return null; // disco diferente
  if (!win && fromDir.startsWith("/") !== to.startsWith("/")) return null;
  let i = 0;
  while (i < a.length && i < b.length && same(a[i]!, b[i]!)) i++;
  const up = a.slice(i).map(() => "..");
  return [...up, ...b.slice(i)].join("/") || ".";
}

/** Junta uma pasta e um caminho relativo (com "/" ou "\\"), resolvendo "..". */
export function resolvePath(dir: string, rel: string): string {
  const win = isWindowsPath(dir);
  const sep = win ? "\\" : "/";
  const out = parts(dir);
  for (const p of parts(rel)) {
    if (p === "..") out.pop();
    else out.push(p);
  }
  const joined = out.join(sep);
  return win ? joined : `/${joined}`;
}

export function baseName(p: string): string {
  return parts(p).pop() ?? p;
}
