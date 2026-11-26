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
}

export interface ExportResult {
  codec: string;
  hardwareEncode: HardwarePreference;
  frames: number;
  bytes: number;
  elapsedMs: number;
  fps: number;
}

export type ToWorker =
  | { type: "init"; canvas: OffscreenCanvas }
  | { type: "proof:open"; source: MediaRef }
  | { type: "proof:play"; mode: "realtime" | "benchmark"; durationUs: number }
  | { type: "proof:stop" }
  | { type: "proof:export"; source: MediaRef; target: OutputRef; settings: ExportSettings }
  | { type: "proof:cancelExport" };

export type FromWorker =
  | { type: "ready"; webgl2: boolean; webcodecs: boolean }
  | { type: "proof:info"; info: SourceInfo }
  | { type: "proof:playStats"; stats: PlaybackStats }
  | { type: "proof:exportProgress"; done: number; total: number }
  | { type: "proof:exportDone"; result: ExportResult; buffer?: ArrayBuffer }
  | { type: "proof:exportCancelled" }
  | { type: "stats"; openFrames: number }
  | { type: "error"; context: string; message: string };
