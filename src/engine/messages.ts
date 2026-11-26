/**
 * Mensagens entre a interface (thread principal) e o Worker do motor.
 * Única porta de entrada do src/engine para o resto do app.
 *
 * Fase 1 / T1.01: só as mensagens da prova técnica. As mensagens do preview
 * de verdade (project, play, pause, seek, export) entram em T1.07 e T1.10.
 */

/** De onde o Worker lê a mídia. */
export type MediaRef =
  /** No app: URL do protocolo media:// servida pelo Rust, com Range. */
  | { kind: "url"; url: string }
  /** No navegador (desenvolvimento sem Tauri): arquivo escolhido pelo usuário. */
  | { kind: "file"; file: File };

/** Para onde o Worker grava o MP4. */
export type OutputRef =
  /** No app: rota de escrita do media://, gravada em disco pelo Rust. */
  | { kind: "url"; url: string }
  /** No navegador: buffer devolvido no fim. */
  | { kind: "memory" };

export interface SourceInfo {
  container: string;
  codec: string | null;
  codecString: string | null;
  width: number;
  height: number;
  rotation: number;
  durationUs: number;
  fps: number | null;
  canDecode: boolean;
  hardwareDecode: HardwarePreference;
  hasAudio: boolean;
}

export type HardwarePreference = "prefer-hardware" | "no-preference";

export interface PlaybackStats {
  mode: "realtime" | "benchmark";
  framesShown: number;
  framesDropped: number;
  elapsedMs: number;
  /** Quadros por segundo efetivamente exibidos. */
  fps: number;
  /** Atraso máximo de um quadro em relação ao relógio, em ms (só realtime). */
  maxLateMs: number;
  done: boolean;
}

export interface ExportSettings {
  width: number;
  height: number;
  fps: { num: number; den: number };
  bitrate: number;
  durationUs: number;
  /** Codec de vídeo pedido (padrão H.264). */
  videoCodec?: "avc" | "hevc";
  /** Incluir faixa de áudio (AAC 48 kHz estéreo). */
  audio?: boolean;
}

/** O que este WebView consegue codificar, para o diálogo de exportação. */
export interface ExportCapabilities {
  avc: boolean;
  hevc: boolean;
  aac: boolean;
}

export interface ExportResult {
  codec: string;
  /** Codec de áudio usado, ou null sem áudio. */
  audioCodec: string | null;
  hardwareEncode: HardwarePreference;
  frames: number;
  bytes: number;
  elapsedMs: number;
  fps: number;
}

import type { Project } from "@/project/types";

/**
 * Worker de áudio (audioWorker.ts): separado do de vídeo para que a decodificação de
 * imagem pesada nunca atrase o som, que é o relógio mestre.
 */
export type ToAudioWorker =
  | { type: "audio:project"; project: Project; sources: Record<string, PreviewSource> }
  /** Pede o PCM do intervalo [from, to) da timeline para tocar no Web Audio. */
  | { type: "audio:render"; session: number; from: number; to: number };

export type FromAudioWorker =
  | { type: "audio:pcm"; session: number; from: number; to: number; chunks: PcmChunk[] }
  | { type: "error"; context: string; message: string };

export type ToWorker =
  | { type: "init"; canvas: OffscreenCanvas }
  | { type: "proof:open"; source: MediaRef }
  | { type: "proof:play"; mode: "realtime" | "benchmark"; durationUs: number }
  | { type: "proof:stop" }
  | { type: "proof:export"; source: MediaRef; target: OutputRef; settings: ExportSettings }
  | { type: "proof:cancelExport" }
  /** O WebCodecs deste WebView decodifica o vídeo? (T1.04: aviso de proxy na biblioteca) */
  | { type: "media:check"; requestId: number; url: string }
  // Preview (T1.07)
  | { type: "preview:attach"; canvas: OffscreenCanvas }
  | { type: "preview:project"; project: Project; sources: Record<string, PreviewSource> }
  | { type: "preview:seek"; t: number }
  /** `at`: instante (performance.timeOrigin + now, em ms) em que `from` começa a tocar. Sem `at`, o Worker usa o próprio relógio. */
  | { type: "preview:play"; from: number; rate: number; at?: number }
  /** Correção pelo relógio do áudio: em `at` (ms absolutos) a timeline está em `t`. */
  | { type: "preview:clock"; t: number; at: number }

  | { type: "preview:pause" }
  | { type: "preview:quality"; scale: PreviewQuality }
  // Exportação do projeto (T1.10)
  | { type: "export:capabilities"; requestId: number; width: number; height: number; fps: { num: number; den: number } }
  | {
      type: "export:start";
      project: Project;
      sources: Record<string, PreviewSource>;
      settings: ExportSettings;
      target: OutputRef;
    }
  | { type: "export:cancel" };

/** Onde o Worker lê cada mídia do projeto (URL do media://). */
export interface PreviewSource {
  url: string;
  kind: "video" | "audio" | "image";
}

/** Áudio decodificado de um trecho de clipe, pronto para o Web Audio. */
export interface PcmChunk {
  clipId: string;
  start: number;
  end: number;
  sampleRate: number;
  /** Planar float32, 1 ou 2 canais. */
  channels: Float32Array[];
  speed: number;
  gain: number;
  clipStart: number;
  clipEnd: number;
  fadeIn: number;
  fadeOut: number;
}

/** Fração da resolução do projeto usada no preview. */
export type PreviewQuality = 1 | 0.5 | 0.25;

export interface DecodeCheck {
  /** true também para arquivos sem trilha de vídeo (áudio, imagem). */
  decodable: boolean;
  hardware: HardwarePreference | null;
  codecString: string | null;
  error?: string;
}

export type FromWorker =
  | { type: "ready"; webgl2: boolean; webcodecs: boolean }
  | { type: "proof:info"; info: SourceInfo }
  | { type: "proof:playStats"; stats: PlaybackStats }
  | { type: "proof:exportProgress"; done: number; total: number }
  | { type: "proof:exportDone"; result: ExportResult; buffer?: ArrayBuffer }
  | { type: "proof:exportCancelled" }
  | { type: "stats"; openFrames: number }
  | { type: "media:checked"; requestId: number; result: DecodeCheck }
  /** Tempo mostrado no preview (início de quadro). Enviado a cada quadro durante a reprodução. */
  | { type: "preview:time"; t: number; playing: boolean }
  | { type: "preview:stats"; droppedFrames: number; openFrames: number; renderMs: number }
  | { type: "export:caps"; requestId: number; caps: ExportCapabilities }
  | { type: "export:progress"; done: number; total: number }
  | { type: "export:done"; result: ExportResult }
  | { type: "export:cancelled" }

  | { type: "error"; context: string; message: string };
