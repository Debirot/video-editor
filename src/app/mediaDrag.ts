/**
 * Arrastar mídia da biblioteca para a timeline com eventos de ponteiro.
 * O drag-and-drop do HTML5 não funciona no WebView2 enquanto o Tauri recebe
 * arquivos soltos do sistema (onFileDrop), então este caminho não usa dataTransfer.
 *
 * A biblioteca chama startMediaDrag no pointerdown; quem recebe (a timeline)
 * registra um alvo com setMediaDropTarget.
 */
import { createStore } from "zustand/vanilla";
import { useStore } from "zustand";
import type { Media } from "@/project/types";

const THRESHOLD_PX = 4;

interface DragState {
  media: Media | null;
  x: number;
  y: number;
  /** O alvo aceita soltar aqui (a timeline mostra a prévia). */
  overTarget: boolean;
}

export const mediaDragStore = createStore<DragState>()(() => ({ media: null, x: 0, y: 0, overTarget: false }));

export function useMediaDrag<T>(selector: (s: DragState) => T): T {
  return useStore(mediaDragStore, selector);
}

export interface MediaDropTarget {
  /** Ponteiro sobre a tela durante o arrasto; devolve true se aceitaria soltar ali. */
  hover: (clientX: number, clientY: number, media: Media) => boolean;
  /** Soltou; devolve true se usou a mídia. */
  drop: (clientX: number, clientY: number, media: Media) => boolean;
  /** Arrasto acabou ou saiu: limpar a prévia. */
  leave: () => void;
}

let target: MediaDropTarget | null = null;

export function setMediaDropTarget(t: MediaDropTarget | null): void {
  target = t;
}

export function startMediaDrag(e: PointerEvent | React.PointerEvent, media: Media): void {
  if (e.button !== 0) return;
  const x0 = e.clientX;
  const y0 = e.clientY;
  let active = false;

  const move = (ev: PointerEvent) => {
    if (!active && Math.hypot(ev.clientX - x0, ev.clientY - y0) < THRESHOLD_PX) return;
    active = true;
    const overTarget = target?.hover(ev.clientX, ev.clientY, media) ?? false;
    mediaDragStore.setState({ media, x: ev.clientX, y: ev.clientY, overTarget });
  };
  const end = (ev: PointerEvent | null) => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("keydown", key, { capture: true });
    if (active && ev) target?.drop(ev.clientX, ev.clientY, media);
    target?.leave();
    mediaDragStore.setState({ media: null, overTarget: false });
  };
  const up = (ev: PointerEvent) => end(ev);
  const key = (ev: KeyboardEvent) => {
    if (ev.key !== "Escape" || !active) return;
    ev.preventDefault();
    ev.stopPropagation();
    end(null);
  };

  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
  window.addEventListener("keydown", key, { capture: true });
}
