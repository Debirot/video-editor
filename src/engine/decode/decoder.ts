/**
 * Decodificação de vídeo com WebCodecs, preferindo hardware.
 *
 * O Mediabunny faz o demux (pacotes codificados); o VideoDecoder decodifica.
 * Mantemos poucos quadros em voo: decodificadores de hardware têm um pool
 * pequeno de superfícies e travam se o consumidor segurar quadros demais.
 */
import { EncodedPacketSink, type InputVideoTrack } from "mediabunny";
import { usToSeconds, type Us } from "@/lib/time";
import { adopt, release } from "../frames";
import type { HardwarePreference } from "../messages";

const MAX_DECODE_QUEUE = 4;

export async function pickDecoderConfig(
  track: InputVideoTrack,
): Promise<{ config: VideoDecoderConfig; hardware: HardwarePreference } | null> {
  const base = await track.getDecoderConfig();
  if (!base) return null;
  for (const hardware of ["prefer-hardware", "no-preference"] as const) {
    const config: VideoDecoderConfig = { ...base, hardwareAcceleration: hardware };
    const support = await VideoDecoder.isConfigSupported(config);
    if (support.supported) return { config, hardware };
  }
  return null;
}

/**
 * Gera os quadros com timestamp em [startUs, endUs), em ordem de apresentação.
 * Cada quadro entregue pertence ao consumidor, que deve chamar release().
 * Interromper o laço (break/return) fecha o decodificador e os quadros pendentes.
 */
export async function* decodeFrames(
  track: InputVideoTrack,
  config: VideoDecoderConfig,
  startUs: Us,
  endUs: Us,
): AsyncGenerator<VideoFrame, void, void> {
  const sink = new EncodedPacketSink(track);
  const key = (await sink.getKeyPacket(usToSeconds(startUs))) ?? (await sink.getFirstPacket());
  if (!key) return;

  const ready: VideoFrame[] = [];
  let failure: Error | null = null;
  let wake: (() => void) | null = null;
  const notify = () => {
    const w = wake;
    wake = null;
    w?.();
  };
  const nextEvent = () => new Promise<void>((resolve) => (wake = resolve));

  const decoder = new VideoDecoder({
    output: (frame) => {
      ready.push(adopt(frame));
      notify();
    },
    error: (e) => {
      failure = e instanceof Error ? e : new Error(String(e));
      notify();
    },
  });
  decoder.addEventListener("dequeue", notify);
  decoder.configure(config);

  let finished = false;
  try {
    for await (const packet of sink.packets(key)) {
      if (failure) throw failure;
      decoder.decode(packet.toEncodedVideoChunk());
      while (decoder.decodeQueueSize > MAX_DECODE_QUEUE && !failure) await nextEvent();

      while (ready.length > 0) {
        const frame = ready.shift()!;
        if (frame.timestamp < startUs) {
          release(frame);
        } else if (frame.timestamp >= endUs) {
          release(frame);
          finished = true;
        } else {
          yield frame;
        }
      }
      if (finished) break;
    }
    if (!finished && !failure) {
      await decoder.flush();
      while (ready.length > 0) {
        const frame = ready.shift()!;
        if (frame.timestamp >= startUs && frame.timestamp < endUs) yield frame;
        else release(frame);
      }
    }
    if (failure) throw failure;
  } finally {
    for (const frame of ready) release(frame);
    ready.length = 0;
    if (decoder.state !== "closed") decoder.close();
  }
}

/**
 * Cursor sobre decodeFrames: devolve o quadro que deve aparecer no instante t
 * (o último com timestamp <= t). Avança só para frente; serve à exportação e
 * a reproduções lineares. O quadro devolvido continua pertencendo ao cursor.
 */
export class FrameCursor {
  private current: VideoFrame | null = null;
  private next: VideoFrame | null = null;
  private done = false;

  constructor(private readonly frames: AsyncGenerator<VideoFrame, void, void>) {}

  async frameAt(t: Us): Promise<VideoFrame | null> {
    while (!this.done) {
      if (!this.next) {
        const r = await this.frames.next();
        if (r.done) {
          this.done = true;
          break;
        }
        this.next = r.value;
      }
      if (this.next.timestamp > t) break;
      release(this.current);
      this.current = this.next;
      this.next = null;
    }
    return this.current;
  }

  async close(): Promise<void> {
    release(this.current);
    release(this.next);
    this.current = this.next = null;
    await this.frames.return();
  }
}
