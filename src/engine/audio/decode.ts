/**
 * Decodificação de áudio no Worker (WebCodecs via Mediabunny AudioSampleSink).
 * Para cada trecho pedido, devolve PCM planar float32 já recortado no ponto exato;
 * a mixagem e o agendamento ficam no Web Audio da thread da interface (src/app/audio.ts),
 * porque o AudioContext não existe em Workers.
 */
import { AudioSampleSink, type Input } from "mediabunny";
import { secondsToUs, usToSeconds } from "@/lib/time";
import { openInput } from "../decode/source";
import type { AudioSegment } from "../evaluate";
import type { PcmChunk, PreviewSource } from "../messages";

const MAX_OPEN = 4;

interface Entry {
  url: string;
  ready: Promise<{ input: Input; sink: AudioSampleSink; firstTs: number } | null>;
}

async function openAudio(url: string) {
  const input = openInput({ kind: "url", url });
  try {
    const track = await input.getPrimaryAudioTrack();
    if (!track || !(await track.canDecode())) {
      input.dispose();
      return null;
    }
    // Mesma referência do vídeo (pool.ts): o primeiro instante do arquivo inteiro.
    const firstTs = secondsToUs(await input.getFirstTimestamp());
    return { input, sink: new AudioSampleSink(track), firstTs };
  } catch (e) {
    input.dispose();
    throw e;
  }
}

export class AudioPool {
  private entries = new Map<string, Entry>();
  private sources: Record<string, PreviewSource> = {};

  setSources(sources: Record<string, PreviewSource>): void {
    this.sources = sources;
    for (const [id, entry] of this.entries) {
      if (sources[id]?.url !== entry.url) void this.evict(id);
    }
  }

  /** PCM do trecho (com o tamanho exato em amostras), ou null se a mídia não tiver áudio decodificável. */
  async render(seg: AudioSegment): Promise<PcmChunk | null> {
    const source = this.sources[seg.mediaId];
    if (!source) return null;
    let entry = this.entries.get(seg.mediaId);
    if (entry) {
      this.entries.delete(seg.mediaId);
    } else {
      entry = { url: source.url, ready: openAudio(source.url) };
    }
    this.entries.set(seg.mediaId, entry);
    while (this.entries.size > MAX_OPEN) await this.evict(this.entries.keys().next().value!);

    const opened = await entry.ready;
    if (!opened) return null;

    const from = usToSeconds(seg.sourceStart + opened.firstTs);
    const span = usToSeconds(seg.end - seg.start) * seg.speed;
    const to = from + span;

    let sampleRate = 0;
    let channels: Float32Array[] = [];
    for await (const sample of opened.sink.samples(from, to)) {
      try {
        if (channels.length === 0) {
          sampleRate = sample.sampleRate;
          const length = Math.max(1, Math.round(span * sampleRate));
          channels = Array.from({ length: Math.min(2, sample.numberOfChannels) }, () => new Float32Array(length));
        }
        const total = channels[0]!.length;
        // Posição deste pedaço dentro do trecho, em amostras; recorta o que cai fora.
        const startFrame = Math.round((sample.timestamp - from) * sampleRate);
        const skip = Math.max(0, -startFrame);
        const at = Math.max(0, startFrame);
        const count = Math.min(sample.numberOfFrames - skip, total - at);
        if (count <= 0) continue;
        channels.forEach((dest, c) => {
          sample.copyTo(dest.subarray(at, at + count), {
            planeIndex: Math.min(c, sample.numberOfChannels - 1),
            format: "f32-planar",
            frameOffset: skip,
            frameCount: count,
          });
        });
      } finally {
        sample.close();
      }
    }
    if (channels.length === 0) return null;
    return {
      clipId: seg.clipId,
      start: seg.start,
      end: seg.end,
      sampleRate,
      channels,
      speed: seg.speed,
      gain: seg.gain,
      clipStart: seg.clipStart,
      clipEnd: seg.clipEnd,
      fadeIn: seg.fadeIn,
      fadeOut: seg.fadeOut,
    };
  }

  private async evict(id: string): Promise<void> {
    const entry = this.entries.get(id);
    this.entries.delete(id);
    try {
      (await entry?.ready)?.input.dispose();
    } catch {
      // falhou ao abrir: nada para fechar
    }
  }
}
