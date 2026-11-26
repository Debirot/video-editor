/**
 * Mapa único de atalhos de teclado. Atalhos configuráveis pelo usuário entram na Fase 3
 * trocando este mapa. As ações ficam em editActions.ts.
 *
 * Combinação = modificadores em ordem fixa (Ctrl, Shift, Alt) + tecla, ex.: "Ctrl+Shift+Z".
 * Cmd no macOS conta como Ctrl. Em símbolos (+, -, =) o Shift é ignorado, porque o
 * layout do teclado pode exigir Shift para digitá-los.
 */

export type Action =
  | "undo"
  | "redo"
  | "split"
  | "delete"
  | "rippleDelete"
  | "copy"
  | "paste"
  | "duplicate"
  | "selectAll"
  | "deselect"
  | "frameBack"
  | "frameForward"
  | "secondBack"
  | "secondForward"
  | "prevCut"
  | "nextCut"
  | "goStart"
  | "goEnd"
  | "toggleSnap"
  | "zoomIn"
  | "zoomOut"
  | "zoomFit"
  | "import"
  | "togglePlay"
  | "shuttleBack"
  | "stop"
  | "shuttleForward"
  | "save"
  | "saveAs"
  | "open"
  | "newProject"
  | "export";

export const SHORTCUTS: Record<string, Action> = {
  "Ctrl+Z": "undo",
  "Ctrl+Shift+Z": "redo",
  "Ctrl+Y": "redo",
  S: "split",
  Delete: "delete",
  Backspace: "delete",
  "Shift+Delete": "rippleDelete",
  "Shift+Backspace": "rippleDelete",
  "Ctrl+C": "copy",
  "Ctrl+V": "paste",
  "Ctrl+D": "duplicate",
  "Ctrl+A": "selectAll",
  Escape: "deselect",
  ArrowLeft: "frameBack",
  ArrowRight: "frameForward",
  "Shift+ArrowLeft": "secondBack",
  "Shift+ArrowRight": "secondForward",
  ArrowUp: "prevCut",
  ArrowDown: "nextCut",
  Home: "goStart",
  End: "goEnd",
  N: "toggleSnap",
  "+": "zoomIn",
  "=": "zoomIn",
  "-": "zoomOut",
  "Shift+Z": "zoomFit",
  "Ctrl+I": "import",
  Space: "togglePlay",
  J: "shuttleBack",
  K: "stop",
  L: "shuttleForward",
  "Ctrl+S": "save",
  "Ctrl+Shift+S": "saveAs",
  "Ctrl+O": "open",
  "Ctrl+N": "newProject",
  "Ctrl+E": "export",
};

export interface KeyLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

export function comboFromEvent(e: KeyLike): string {
  let key = e.key === " " ? "Space" : e.key;
  const isSymbol = key.length === 1 && !/[a-z0-9]/i.test(key);
  if (key.length === 1) key = key.toUpperCase();
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push("Ctrl");
  if (e.shiftKey && !isSymbol) parts.push("Shift");
  if (e.altKey) parts.push("Alt");
  parts.push(key);
  return parts.join("+");
}

export function actionFor(e: KeyLike): Action | null {
  return SHORTCUTS[comboFromEvent(e)] ?? null;
}

/** Atalhos não valem enquanto o usuário digita num campo. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}
