/**
 * Prova técnica (T1.01): valida o pipeline inteiro antes de investir em interface.
 *
 *   media:// (Range) → Mediabunny (demux) → VideoDecoder (hardware)
 *   → WebGL2 (compositor) → VideoEncoder → Mediabunny (mux MP4) → media:// (escrita)
 *
 * Tudo aqui roda no Worker. Este arquivo deixa de existir quando o preview (T1.07)
 * e a exportação (T1.10) estiverem prontos.
 */
import type { Input, InputVideoTrack } from "mediabunny";
import { secondsToUs, frameToUs, type Us } from "@/lib/time";
import { Compositor } from "./compositor/compositor";
import { decodeFrames, FrameCursor, pickDecoderConfig } from "./decode/decoder";
import { openInput, primaryVideoTrack } from "./decode/source";
import { runExport } from "./export";
import { release } from "./frames";
import type { ExportResult, ExportSettings, MediaRef, OutputRef, PlaybackStats, SourceInfo } from "./messages";

interface OpenSource {
  input: Input;
  track: InputVideoTrack;
  config: VideoDecoderConfig;
  info: SourceInfo;
}

export async function openSource(ref: MediaRef): Promise<OpenSource> {
  const input = openInput(ref);
  try {
    const track = await primaryVideoTrack(input);
    const picked = await pickDecoderConfig(track);
    const [format, codecString, width, height, rotation, duration, stats, audio] = await Promise.all([
      input.getFormat(),
      track.getCodecParameterString(),
      track.getDisplayWidth(),
      track.getDisplayHeight(),
      track.getRotation(),
      input.computeDuration(),
      track.computePacketStats(120),
      input.getPrimaryAudioTrack(),
    ]);
    const info: SourceInfo = {
      container: format.name,
      codec: await track.getCodec(),
      codecString,
      width,
      height,
      rotation,
      durationUs: secondsToUs(duration),
      fps: stats.averagePacketRate || null,
      canDecode: picked !== null,
      hardwareDecode: picked?.hardware ?? "no-preference",
      hasAudio: audio !== null,
    };
    if (!picked) {
      throw Object.assign(new Error(`O WebCodecs não decodifica ${codecString ?? "este codec"} aqui. Precisaria de proxy.`), {
        info,
      });
    }
    return { input, track, config: picked.config, info };
  } catch (e) {
    input.dispose();
    throw e;
  }
}

/** Cede a vez ao laço de eventos sem o atraso mínimo do setTimeout. */
function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => {
    const ch = new MessageChannel();
    ch.port1.onmessage = () => resolve();
    ch.port2.postMessage(null);
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Reproduz os primeiros `durationUs` da fonte no canvas do preview.
 * realtime: segue o relógio e descarta quadros atrasados (como o preview fará).
 * benchmark: decodifica e desenha o mais rápido possível (mede a capacidade).
 */
export async function playProof(
  src: OpenSource,
  compositor: Compositor,
  mode: "realtime" | "benchmark",
  durationUs: Us,
  signal: AbortSignal,
  report: (s: PlaybackStats) => void,
): Promise<PlaybackStats> {
  const frameMs = src.info.fps ? 1000 / src.info.fps : 1000 / 30;
  const stats: PlaybackStats = {
    mode,
    framesShown: 0,
    framesDropped: 0,
    elapsedMs: 0,
    fps: 0,
    maxLateMs: 0,
    done: false,
  };
  const t0 = performance.now();
  let firstTs: number | null = null;
  let lastReport = t0;

  for await (const frame of decodeFrames(src.track, src.config, 0, durationUs)) {
    if (signal.aborted) {
      release(frame);
      break;
    }
    firstTs ??= frame.timestamp;
    const due = t0 + (frame.timestamp - firstTs) / 1000;

    if (mode === "realtime") {
      const now = performance.now();
      if (now > due + frameMs) {
        stats.framesDropped++;
        release(frame);
        continue;
      }
      if (due > now) await sleep(due - now);
      stats.maxLateMs = Math.max(stats.maxLateMs, performance.now() - due);
    }

    compositor.drawFrameContain(frame);
    release(frame);
    stats.framesShown++;
    if (mode === "benchmark") {
      compositor.gl.flush();
      await yieldToEventLoop();
    }

    const now = performance.now();
    if (now - lastReport > 250) {
      lastReport = now;
      stats.elapsedMs = now - t0;
      stats.fps = stats.framesShown / (stats.elapsedMs / 1000);
      report({ ...stats });
    }
  }

  stats.elapsedMs = performance.now() - t0;
  stats.fps = stats.framesShown / (stats.elapsedMs / 1000);
  stats.done = true;
  return stats;
}

/** Exporta os primeiros segundos da fonte, redimensionados para o tamanho de saída. */
export async function exportProof(
  sourceRef: MediaRef,
  target: OutputRef,
  settings: ExportSettings,
  signal: AbortSignal,
  onProgress: (done: number, total: number) => void,
): Promise<{ result: ExportResult; buffer?: ArrayBuffer }> {
  const src = await openSource(sourceRef);
  // Um quadro de folga no fim para o cursor sempre ter o quadro do último instante.
  const endUs = settings.durationUs + frameToUs(1, settings.fps);
  const cursor = new FrameCursor(decodeFrames(src.track, src.config, 0, endUs));
  try {
    return await runExport({
      target,
      settings,
      signal,
      onProgress,
      render: async (t, compositor) => {
        const frame = await cursor.frameAt(t);
        if (frame) compositor.drawFrameContain(frame);
        else compositor.clear();
      },
    });
  } finally {
    await cursor.close();
    src.input.dispose();
  }
}
