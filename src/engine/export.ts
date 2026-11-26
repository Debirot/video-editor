/**
 * Laço de exportação: compõe quadro a quadro, codifica com VideoEncoder (e o áudio
 * com AudioEncoder) e grava MP4 com o muxer do Mediabunny, sem acumular o arquivo na memória.
 *
 * Quem chama decide o que desenhar em cada instante (render) e qual áudio tocar (audio).
 * Assim o mesmo laço serve à prova técnica (T1.01) e à exportação do projeto (T1.10).
 * O áudio é codificado em blocos de 1 s à frente do vídeo, para o muxer intercalar as faixas.
 */
import {
  BufferTarget,
  EncodedAudioPacketSource,
  EncodedPacket,
  EncodedVideoPacketSource,
  Mp4OutputFormat,
  Output,
  StreamTarget,
  type AudioCodec,
  type StreamTargetChunk,
  type VideoCodec,
} from "mediabunny";
import { MIX_CHANNELS, MIX_RATE, sampleIndex } from "./audio/mix";
import { frameToUs, fpsToNumber, usToFrame, type Rational, type Us } from "@/lib/time";
import { Compositor } from "./compositor/compositor";
import type { ExportCapabilities, ExportResult, ExportSettings, HardwarePreference, OutputRef } from "./messages";

const MAX_ENCODE_QUEUE = 8;
const KEYFRAME_INTERVAL_S = 2;
const WRITE_CHUNK_BYTES = 4 * 2 ** 20;
const AUDIO_BLOCK_US = 1_000_000;
const AUDIO_BITRATE = 192_000;

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

/** HEVC Main, nível 4.0 até 1080p30 e 5.1 acima. */
function hevcCodecString(width: number, height: number, fps: Rational): string {
  return width * height * fpsToNumber(fps) <= 1920 * 1088 * 30 ? "hvc1.1.6.L120.B0" : "hvc1.1.6.L153.B0";
}

/**
 * Escolhe o primeiro codec suportado, preferindo hardware.
 * H.264 é o padrão; H.265 só quando pedido (e o diálogo só oferece se for suportado).
 * VP9 só existe como último recurso para navegadores de desenvolvimento sem H.264
 * (Chromium sem codecs proprietários).
 */
export async function pickEncoder(settings: ExportSettings): Promise<EncoderChoice> {
  const avc = { codec: avcCodecString(settings.width, settings.height, settings.fps), container: "avc" as const };
  const hevc = { codec: hevcCodecString(settings.width, settings.height, settings.fps), container: "hevc" as const };
  const candidates: Array<{ codec: string; container: VideoCodec }> =
    settings.videoCodec === "hevc" ? [hevc] : [avc, { codec: "vp09.00.40.08", container: "vp9" }];
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
    ...(codec.startsWith("hvc1") ? { hevc: { format: "hevc" as const } } : {}),
  };
}

async function videoSupported(codec: string, s: ExportSettings): Promise<boolean> {
  for (const hardware of ["prefer-hardware", "no-preference"] as const) {
    if ((await VideoEncoder.isConfigSupported(encoderConfig(codec, s, hardware))).supported) return true;
  }
  return false;
}

/** AAC (padrão do MP4); Opus só como alternativa em navegadores sem AAC. */
async function pickAudioEncoder(): Promise<{ config: AudioEncoderConfig; container: AudioCodec } | null> {
  const candidates: Array<{ codec: string; container: AudioCodec }> = [
    { codec: "mp4a.40.2", container: "aac" },
    { codec: "opus", container: "opus" },
  ];
  for (const { codec, container } of candidates) {
    const config: AudioEncoderConfig = { codec, sampleRate: MIX_RATE, numberOfChannels: MIX_CHANNELS, bitrate: AUDIO_BITRATE };
    if (typeof AudioEncoder !== "undefined" && (await AudioEncoder.isConfigSupported(config)).supported) return { config, container };
  }
  return null;
}

/** H.264, H.265 e AAC disponíveis neste WebView para o tamanho e FPS pedidos. */
export async function exportCapabilities(width: number, height: number, fps: Rational): Promise<ExportCapabilities> {
  const s: ExportSettings = { width, height, fps, bitrate: 8_000_000, durationUs: 0 };
  const [avc, hevc, audio] = await Promise.all([
    videoSupported(avcCodecString(width, height, fps), s),
    videoSupported(hevcCodecString(width, height, fps), s),
    pickAudioEncoder(),
  ]);
  return { avc, hevc, aac: audio?.container === "aac" };
}

/** Número de quadros para cobrir `durationUs` (o último quadro parcial conta). */
export function frameCount(durationUs: Us, fps: Rational): number {
  return durationUs <= 0 ? 0 : usToFrame(durationUs - 1, fps) + 1;
}

/** `onError` avisa o laço na hora: uma falha de gravação para a exportação em vez de deixá-la presa. */
function createTarget(ref: OutputRef, onError: (e: Error) => void): StreamTarget | BufferTarget {
  if (ref.kind === "memory") return new BufferTarget();
  const writable = new WritableStream<StreamTargetChunk>({
    async write(chunk) {
      try {
        const res = await fetch(`${ref.url}?pos=${chunk.position}`, { method: "PUT", body: chunk.data });
        if (!res.ok) throw new Error(`Falha ao gravar no disco: ${res.status} ${await res.text()}`);
      } catch (e) {
        const error = e instanceof Error ? e : new Error(String(e));
        onError(error);
        throw error;
      }
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
  /** PCM estéreo 48 kHz (planar) de [from, to) da timeline. Sem isso, o MP4 sai sem áudio. */
  audio?: (from: Us, to: Us) => Promise<Float32Array[]>;
  onProgress: (done: number, total: number) => void;
}

export async function runExport(opts: RunExportOptions): Promise<{ result: ExportResult; buffer?: ArrayBuffer }> {
  const { settings, signal } = opts;
  const started = performance.now();
  const choice = await pickEncoder(settings);
  const totalFrames = frameCount(settings.durationUs, settings.fps);
  const endUs = frameToUs(totalFrames, settings.fps);
  const keyEvery = Math.max(1, Math.round(fpsToNumber(settings.fps) * KEYFRAME_INTERVAL_S));

  const canvas = new OffscreenCanvas(settings.width, settings.height);
  const compositor = new Compositor(canvas, { preserveDrawingBuffer: true });

  let failure: Error | null = null;
  let wake: (() => void) | null = null;
  const notify = () => {
    const w = wake;
    wake = null;
    w?.();
  };
  const target = createTarget(opts.target, (e) => {
    failure ??= e;
    notify();
  });
  const output = new Output({ format: new Mp4OutputFormat(), target });
  const videoSource = new EncodedVideoPacketSource(choice.container);
  output.addVideoTrack(videoSource, { frameRate: fpsToNumber(settings.fps) });
  const audioChoice = opts.audio && settings.audio !== false ? await pickAudioEncoder() : null;
  const audioSource = audioChoice ? new EncodedAudioPacketSource(audioChoice.container) : null;
  if (audioSource) output.addAudioTrack(audioSource);
  await output.start();

  // Uma fila por faixa: o muxer pode segurar um pacote de vídeo até chegar o áudio do
  // mesmo instante, então uma fila única travaria (o áudio ficaria atrás do vídeo).
  let muxChain: Promise<void> = Promise.resolve();
  let audioChain: Promise<void> = Promise.resolve();

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

  const audioEncoder = audioChoice
    ? new AudioEncoder({
        output: (chunk, meta) => {
          const packet = EncodedPacket.fromEncodedChunk(chunk);
          audioChain = audioChain.then(() => audioSource!.add(packet, meta));
          audioChain.catch((e) => {
            failure ??= e instanceof Error ? e : new Error(String(e));
            notify();
          });
        },
        error: (e) => {
          failure ??= e instanceof Error ? e : new Error(String(e));
          notify();
        },
      })
    : null;
  audioEncoder?.configure(audioChoice!.config);

  /** Codifica o áudio até `until` (blocos de 1 s, com timestamps pelas amostras). */
  let audioUntil = 0;
  const encodeAudioUntil = async (until: Us) => {
    if (!audioEncoder || !opts.audio) return;
    while (audioUntil < until) {
      const to = Math.min(endUs, audioUntil + AUDIO_BLOCK_US);
      const planes = await opts.audio(audioUntil, to);
      const frames = planes[0]?.length ?? 0;
      if (frames > 0) {
        const data = new Float32Array(frames * planes.length);
        planes.forEach((p, c) => data.set(p, c * frames));
        const audioData = new AudioData({
          format: "f32-planar",
          sampleRate: MIX_RATE,
          numberOfFrames: frames,
          numberOfChannels: planes.length,
          timestamp: Math.round((sampleIndex(audioUntil) * 1_000_000) / MIX_RATE),
          data,
        });
        try {
          audioEncoder.encode(audioData);
        } finally {
          audioData.close();
        }
      }
      audioUntil = to;
    }
  };

  try {
    for (let n = 0; n < totalFrames; n++) {
      if (signal.aborted) throw new ExportCancelled();
      if (failure) throw failure;

      const t = frameToUs(n, settings.fps);
      await encodeAudioUntil(Math.min(endUs, t + AUDIO_BLOCK_US));
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

    await encodeAudioUntil(endUs);
    await encoder.flush();
    await audioEncoder?.flush();
    await Promise.all([muxChain, audioChain]);
    if (failure) throw failure;
    await output.finalize();
    opts.onProgress(totalFrames, totalFrames);

    const elapsedMs = performance.now() - started;
    const buffer = target instanceof BufferTarget ? (target.buffer ?? undefined) : undefined;
    return {
      buffer,
      result: {
        codec: choice.codec,
        audioCodec: audioChoice?.config.codec ?? null,
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
    if (audioEncoder && audioEncoder.state !== "closed") audioEncoder.close();
    compositor.dispose();
  }
}
