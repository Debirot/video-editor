/**
 * Laço de exportação: compõe quadro a quadro, codifica com VideoEncoder e
 * grava MP4 com o muxer do Mediabunny, sem acumular o arquivo na memória.
 *
 * Quem chama decide o que desenhar em cada instante (render). Assim o mesmo
 * laço serve à prova técnica (T1.01) e à exportação do projeto (T1.10).
 */
import {
  BufferTarget,
  EncodedPacket,
  EncodedVideoPacketSource,
  Mp4OutputFormat,
  Output,
  StreamTarget,
  type StreamTargetChunk,
  type VideoCodec,
} from "mediabunny";
import { frameToUs, fpsToNumber, usToFrame, type Rational, type Us } from "@/lib/time";
import { Compositor } from "./compositor/compositor";
import type { ExportResult, ExportSettings, HardwarePreference, OutputRef } from "./messages";

const MAX_ENCODE_QUEUE = 8;
const KEYFRAME_INTERVAL_S = 2;
const WRITE_CHUNK_BYTES = 4 * 2 ** 20;

export interface EncoderChoice {
  /** String de codec do WebCodecs, ex.: "avc1.640028". */
  codec: string;
  /** Nome do codec no Mediabunny. */
  container: VideoCodec;
  hardware: HardwarePreference;
}

/** Nível H.264 suficiente para a resolução e o FPS pedidos. */
function avcCodecString(width: number, height: number, fps: Rational): string {
  const rate = width * height * fpsToNumber(fps);
  if (rate <= 1920 * 1088 * 30) return "avc1.640028"; // High 4.0
  if (rate <= 1920 * 1088 * 60) return "avc1.64002a"; // High 4.2
  return "avc1.640033"; // High 5.1 (4K30)
}

/**
 * Escolhe o primeiro codec suportado, preferindo hardware.
 * H.264 é o alvo; VP9 só existe como último recurso para navegadores de
 * desenvolvimento sem H.264 (Chromium sem codecs proprietários).
 */
export async function pickEncoder(settings: ExportSettings): Promise<EncoderChoice> {
  const candidates: Array<{ codec: string; container: VideoCodec }> = [
    { codec: avcCodecString(settings.width, settings.height, settings.fps), container: "avc" },
    { codec: "vp09.00.40.08", container: "vp9" },
  ];
  for (const { codec, container } of candidates) {
    for (const hardware of ["prefer-hardware", "no-preference"] as const) {
      const support = await VideoEncoder.isConfigSupported(encoderConfig(codec, settings, hardware));
      if (support.supported) return { codec, container, hardware };
    }
  }
  throw new Error("Nenhum codificador de vídeo suportado neste WebView.");
}

function encoderConfig(codec: string, s: ExportSettings, hardware: HardwarePreference): VideoEncoderConfig {
  return {
    codec,
    width: s.width,
    height: s.height,
    bitrate: s.bitrate,
    framerate: fpsToNumber(s.fps),
    hardwareAcceleration: hardware,
    latencyMode: "quality",
    ...(codec.startsWith("avc1") ? { avc: { format: "avc" as const } } : {}),
  };
}

function createTarget(ref: OutputRef): StreamTarget | BufferTarget {
  if (ref.kind === "memory") return new BufferTarget();
  const writable = new WritableStream<StreamTargetChunk>({
    async write(chunk) {
      const res = await fetch(`${ref.url}?pos=${chunk.position}`, { method: "PUT", body: chunk.data });
      if (!res.ok) throw new Error(`Falha ao gravar no disco: ${res.status} ${await res.text()}`);
    },
  });
  return new StreamTarget(writable, { chunked: true, chunkSize: WRITE_CHUNK_BYTES });
}

export class ExportCancelled extends Error {
  constructor() {
    super("Exportação cancelada");
    this.name = "ExportCancelled";
  }
}

export interface RunExportOptions {
  target: OutputRef;
  settings: ExportSettings;
  signal: AbortSignal;
  /** Desenha no compositor o que aparece no instante t. */
  render: (t: Us, compositor: Compositor) => Promise<void>;
  onProgress: (done: number, total: number) => void;
}

export async function runExport(opts: RunExportOptions): Promise<{ result: ExportResult; buffer?: ArrayBuffer }> {
  const { settings, signal } = opts;
  const started = performance.now();
  const choice = await pickEncoder(settings);
  const totalFrames = usToFrame(settings.durationUs, settings.fps);
  const keyEvery = Math.max(1, Math.round(fpsToNumber(settings.fps) * KEYFRAME_INTERVAL_S));

  const canvas = new OffscreenCanvas(settings.width, settings.height);
  const compositor = new Compositor(canvas, { preserveDrawingBuffer: true });

  const target = createTarget(opts.target);
  const output = new Output({ format: new Mp4OutputFormat(), target });
  const videoSource = new EncodedVideoPacketSource(choice.container);
  output.addVideoTrack(videoSource, { frameRate: fpsToNumber(settings.fps) });
  await output.start();

  let failure: Error | null = null;
  let muxChain: Promise<void> = Promise.resolve();
  let wake: (() => void) | null = null;
  const notify = () => {
    const w = wake;
    wake = null;
    w?.();
  };

  const encoder = new VideoEncoder({
    output: (chunk, meta) => {
      const packet = EncodedPacket.fromEncodedChunk(chunk);
      muxChain = muxChain.then(() => videoSource.add(packet, meta));
      muxChain.catch((e) => {
        failure ??= e instanceof Error ? e : new Error(String(e));
        notify();
      });
    },
    error: (e) => {
      failure ??= e instanceof Error ? e : new Error(String(e));
      notify();
    },
  });
  encoder.addEventListener("dequeue", notify);
  encoder.configure(encoderConfig(choice.codec, settings, choice.hardware));

  try {
    for (let n = 0; n < totalFrames; n++) {
      if (signal.aborted) throw new ExportCancelled();
      if (failure) throw failure;

      const t = frameToUs(n, settings.fps);
      await opts.render(t, compositor);
      const frame = new VideoFrame(canvas, { timestamp: t, duration: frameToUs(n + 1, settings.fps) - t });
      try {
        encoder.encode(frame, { keyFrame: n % keyEvery === 0 });
      } finally {
        frame.close();
      }

      while (encoder.encodeQueueSize > MAX_ENCODE_QUEUE && !failure && !signal.aborted) {
        await new Promise<void>((resolve) => (wake = resolve));
      }
      if (n % 10 === 0) opts.onProgress(n, totalFrames);
    }

    await encoder.flush();
    await muxChain;
    if (failure) throw failure;
    await output.finalize();
    opts.onProgress(totalFrames, totalFrames);

    const elapsedMs = performance.now() - started;
    const buffer = target instanceof BufferTarget ? (target.buffer ?? undefined) : undefined;
    return {
      buffer,
      result: {
        codec: choice.codec,
        hardwareEncode: choice.hardware,
        frames: totalFrames,
        bytes: buffer?.byteLength ?? -1,
        elapsedMs,
        fps: totalFrames / (elapsedMs / 1000),
      },
    };
  } catch (e) {
    await output.cancel().catch(() => {});
    throw e;
  } finally {
    if (encoder.state !== "closed") encoder.close();
    compositor.dispose();
  }
}
