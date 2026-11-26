/**
 * Estado de tela que não vai para o project.json: playhead, zoom e rolagem da timeline.
 * A timeline (canvas) e o preview leem daqui; T1.07 liga o playhead à reprodução.
 */
import { createStore } from "zustand/vanilla";
import { useStore } from "zustand";
import type { Us } from "@/lib/time";
import type { PreviewQuality } from "@/engine/messages";
import { DEFAULT_PX_PER_SECOND } from "@/timeline/viewport";

export interface ViewState {
  /** Posição do playhead, sempre no início de um quadro do projeto. */
  playhead: Us;
  pxPerSecond: number;
  scrollX: number;
  scrollY: number;
  /** Largura visível da área das trilhas (px), medida pelo canvas. */
  viewportWidth: number;
  /** Encaixe nas bordas de clipes e no playhead (usado ao arrastar, T1.06b). */
  snap: boolean;
  /** Preview tocando (o Worker avisa quando chega ao fim). */
  playing: boolean;
  /** Velocidade: 1 normal, 2/4/8 com L repetido, negativa com J. */
  rate: number;
  quality: PreviewQuality;
  /** Diagnóstico do preview, mostrado em desenvolvimento. */
  droppedFrames: number;
  openFrames: number;
}

export const viewStore = createStore<ViewState>()(() => ({
  playhead: 0,
  pxPerSecond: DEFAULT_PX_PER_SECOND,
  scrollX: 0,
  scrollY: 0,
  viewportWidth: 0,
  snap: true,
  playing: false,
  rate: 1,
  quality: 1,
  droppedFrames: 0,
  openFrames: 0,
}));

export function useView<T>(selector: (s: ViewState) => T): T {
  return useStore(viewStore, selector);
}
