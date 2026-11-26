/**
 * Cliente do Worker do motor para o app. Um Worker só, criado na primeira chamada.
 *
 * - media:check: a biblioteca pergunta se o WebCodecs decodifica um vídeo.
 * - preview: envia o projeto (a cada mudança) e o playhead (quando o usuário o move);
 *   recebe o tempo mostrado durante a reprodução e atualiza o viewStore.
 */
import type { DecodeCheck, FromAudioWorker, FromWorker, PreviewSource, ToAudioWorker, ToWorker } from "@/engine/messages";
import { isTauri, mediaReadUrl } from "@/lib/ipc";
import { projectStore } from "@/project/store";
import type { Project } from "@/project/types";
import { timeToX } from "@/timeline/viewport";
import { frameToUs } from "@/lib/time";
import { projectDuration } from "@/project/queries";
import { AudioOut } from "./audio";
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

let audioWorker: Worker | null = null;

function sendAudio(msg: ToAudioWorker): void {
  if (!audioWorker) {
    audioWorker = new Worker(new URL("../engine/audioWorker.ts", import.meta.url), { type: "module" });
    audioWorker.onmessage = (ev: MessageEvent<FromAudioWorker>) => {
      const m = ev.data;
      if (m.type === "audio:pcm") audio.receive(m.session, m.to, m.chunks);
      else errorListeners.forEach((l) => l(m.message));
    };
  }
  audioWorker.postMessage(msg);
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
        // O Worker chegou ao fim: o som também para.
        if (!msg.playing && viewStore.getState().playing) audio.stop();
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

const audio = new AudioOut({
  requestPcm: (session, from, to) => sendAudio({ type: "audio:render", session, from, to }),
  sendClock: (t, at) => send({ type: "preview:clock", t, at }),
  duration: () => projectDuration(projectStore.getState().project),
});

/** Mudanças no projeto durante a reprodução reiniciam o som do ponto atual (agrupadas). */
let restartTimer: ReturnType<typeof setTimeout> | null = null;
function restartAudioSoon(): void {
  if (restartTimer) return;
  restartTimer = setTimeout(() => {
    restartTimer = null;
    const { playing, rate } = viewStore.getState();
    if (playing && rate === 1) play(1, audio.timelineNow());
  }, 120);
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

  const sendProject = (project: Project) => {
    const sources = sourcesOf(project);
    send({ type: "preview:project", project, sources });
    sendAudio({ type: "audio:project", project, sources });
  };
  sendProject(projectStore.getState().project);
  send({ type: "preview:quality", scale: viewStore.getState().quality });
  send({ type: "preview:seek", t: viewStore.getState().playhead });

  projectStore.subscribe((s, prev) => {
    if (s.project === prev.project) return;
    sendProject(s.project);
    if (audio.active) restartAudioSoon();
  });
  viewStore.subscribe((s, prev) => {
    if (s.playhead !== prev.playhead && s.playhead !== enginePlayhead) {
      enginePlayhead = null;
      // Pulo durante a reprodução com som: recomeça o som (e o vídeo) do novo ponto.
      if (s.playing && s.rate === 1 && audio.active) play(1, s.playhead);
      else send({ type: "preview:seek", t: s.playhead });
    }
    if (s.quality !== prev.quality) send({ type: "preview:quality", scale: s.quality });
  });
}

// ─── Controles de reprodução ─────────────────────────────────────────────────

/**
 * Toca a partir de `from` (padrão: playhead). Em 1× o som toca e o relógio do áudio
 * manda; em outras velocidades (J/L) fica mudo e o Worker usa o próprio relógio.
 */
export function play(rate = 1, from = viewStore.getState().playhead): void {
  const project = projectStore.getState().project;
  const end = projectDuration(project);
  if (end === 0) return;
  // Tocar no fim volta ao começo (mesma regra do Worker).
  if (rate > 0 && from >= end - frameToUs(1, project.settings.fps)) from = 0;
  viewStore.setState({ playing: true, rate });
  if (rate === 1) {
    const at = audio.start(from);
    send({ type: "preview:play", from, rate, at });
  } else {
    audio.stop();
    send({ type: "preview:play", from, rate });
  }
}

export function pause(): void {
  audio.stop();
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
