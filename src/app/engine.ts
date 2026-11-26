/**
 * Cliente do Worker do motor para o app. Um Worker só, criado na primeira chamada.
 *
 * - media:check: a biblioteca pergunta se o WebCodecs decodifica um vídeo.
 * - preview: envia o projeto (a cada mudança) e o playhead (quando o usuário o move);
 *   recebe o tempo mostrado durante a reprodução e atualiza o viewStore.
 */
import type { DecodeCheck, FromWorker, PreviewSource, ToWorker } from "@/engine/messages";
import { isTauri, mediaReadUrl } from "@/lib/ipc";
import { projectStore } from "@/project/store";
import type { Project } from "@/project/types";
import { timeToX } from "@/timeline/viewport";
import { viewStore } from "./viewStore";

let worker: Worker | null = null;
let nextRequest = 1;
const waiting = new Map<number, (r: DecodeCheck) => void>();
const errorListeners = new Set<(message: string) => void>();

/** Último playhead vindo do Worker: mudanças iguais a ele não viram seek (evita eco). */
let enginePlayhead: number | null = null;

function send(msg: ToWorker, transfer: Transferable[] = []): void {
  getWorker().postMessage(msg, transfer);
}

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL("../engine/worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = (ev: MessageEvent<FromWorker>) => {
    const msg = ev.data;
    switch (msg.type) {
      case "media:checked":
        waiting.get(msg.requestId)?.(msg.result);
        waiting.delete(msg.requestId);
        return;
      case "preview:time":
        enginePlayhead = msg.t;
        viewStore.setState((s) => ({
          playhead: msg.t,
          playing: msg.playing,
          rate: msg.playing ? s.rate : 1,
        }));
        if (msg.playing) followPlayhead(msg.t);
        return;
      case "preview:stats":
        viewStore.setState({ droppedFrames: msg.droppedFrames, openFrames: msg.openFrames });
        return;
      case "error":
        errorListeners.forEach((l) => l(msg.message));
        return;
    }
  };
  return worker;
}

export function checkDecodable(url: string): Promise<DecodeCheck> {
  const requestId = nextRequest++;
  return new Promise((resolve) => {
    waiting.set(requestId, resolve);
    send({ type: "media:check", requestId, url });
  });
}

export function onEngineError(listener: (message: string) => void): () => void {
  errorListeners.add(listener);
  return () => errorListeners.delete(listener);
}

/** Durante a reprodução, a timeline vira a página quando o playhead passa de 90% da largura. */
function followPlayhead(t: number): void {
  const v = viewStore.getState();
  const vp = { pxPerSecond: v.pxPerSecond, scrollX: v.scrollX, width: v.viewportWidth };
  const x = timeToX(t, vp);
  if (vp.width > 0 && (x > vp.width * 0.9 || x < 0)) {
    viewStore.setState({ scrollX: Math.max(0, v.scrollX + x - vp.width * 0.1) });
  }
}

function sourcesOf(project: Project): Record<string, PreviewSource> {
  if (!isTauri()) return {};
  return Object.fromEntries(project.media.map((m) => [m.id, { url: mediaReadUrl(m.path), kind: m.kind }]));
}

let attached = false;

/**
 * Entrega o canvas do preview ao Worker (uma vez só: o controle passa para o Worker)
 * e começa a sincronizar projeto, playhead e qualidade.
 */
export function attachPreviewCanvas(canvas: HTMLCanvasElement): void {
  if (attached || canvas.dataset.transferred) return;
  attached = true;
  canvas.dataset.transferred = "1";
  const offscreen = canvas.transferControlToOffscreen();
  send({ type: "preview:attach", canvas: offscreen }, [offscreen]);

  const sendProject = (project: Project) => send({ type: "preview:project", project, sources: sourcesOf(project) });
  sendProject(projectStore.getState().project);
  send({ type: "preview:quality", scale: viewStore.getState().quality });
  send({ type: "preview:seek", t: viewStore.getState().playhead });

  projectStore.subscribe((s, prev) => {
    if (s.project !== prev.project) sendProject(s.project);
  });
  viewStore.subscribe((s, prev) => {
    if (s.playhead !== prev.playhead && s.playhead !== enginePlayhead) {
      enginePlayhead = null;
      send({ type: "preview:seek", t: s.playhead });
    }
    if (s.quality !== prev.quality) send({ type: "preview:quality", scale: s.quality });
  });
}

// ─── Controles de reprodução ─────────────────────────────────────────────────

export function play(rate = 1): void {
  viewStore.setState({ playing: true, rate });
  send({ type: "preview:play", from: viewStore.getState().playhead, rate });
}

export function pause(): void {
  if (!viewStore.getState().playing) return;
  viewStore.setState({ playing: false, rate: 1 });
  send({ type: "preview:pause" });
}

export function togglePlay(): void {
  if (viewStore.getState().playing) pause();
  else play(1);
}

/**
 * J/L: tocar para trás/para frente; repetir dobra a velocidade (até 8×).
 * Apertar o sentido oposto enquanto toca volta para 1× naquele sentido.
 */
export function shuttle(direction: 1 | -1): void {
  const { playing, rate } = viewStore.getState();
  const sameDirection = playing && Math.sign(rate) === direction;
  const next = sameDirection ? Math.min(8, Math.abs(rate) * 2) * direction : direction;
  play(next);
}
