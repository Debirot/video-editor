/**
 * Fontes de imagem do preview: um decodificador por mídia em uso, no máximo
 * MAX_DECODERS abertos (os menos usados são fechados), e imagens fixas decodificadas uma vez.
 *
 * Reprodução para frente reaproveita o decodificador (FrameCursor só anda para frente).
 * Voltar no tempo ou pular mais de JUMP_US recomeça do keyframe anterior.
 */
import type { Input, InputVideoTrack } from "mediabunny";
import { secondsToUs, type Us } from "@/lib/time";
import { decodeFrames, FrameCursor, pickDecoderConfig } from "./decoder";
import { openInput, primaryVideoTrack } from "./source";
import type { PreviewSource } from "../messages";

export const MAX_DECODERS = 6;
const JUMP_US = 2_000_000;

export interface Picture {
  image: VideoFrame | ImageBitmap;
  width: number;
  height: number;
  /** Rotação gravada no arquivo (vídeo de celular), em graus no sentido horário. */
  rotation: number;
}

interface VideoEntry {
  kind: "video";
  url: string;
  ready: Promise<{ input: Input; track: InputVideoTrack; config: VideoDecoderConfig; firstTs: Us; rotation: number }>;
  cursor: FrameCursor | null;
  /** Último tempo pedido (no relógio do arquivo). */
  last: Us;
}

interface ImageEntry {
  kind: "image";
  url: string;
  ready: Promise<ImageBitmap>;
}

type Entry = VideoEntry | ImageEntry;

async function openVideo(url: string) {
  const input = openInput({ kind: "url", url });
  try {
    const track = await primaryVideoTrack(input);
    const picked = await pickDecoderConfig(track);
    if (!picked) throw new Error("codec não decodificável aqui (precisa de proxy)");
    // Referência do arquivo inteiro (não só da trilha de vídeo): o áudio usa a mesma,
    // então imagem e som ficam alinhados mesmo quando uma trilha começa depois da outra.
    const firstTs = secondsToUs(await input.getFirstTimestamp());
    return { input, track, config: picked.config, firstTs, rotation: await track.getRotation() };
  } catch (e) {
    input.dispose();
    throw e;
  }
}

/** Maior lado de uma imagem fixa na memória e na GPU (fotos de 48 MP viram 4096 px). */
export const MAX_IMAGE_SIDE = 4096;

/**
 * Lê o arquivo inteiro. O media:// entrega no máximo 2 MB por resposta a arquivos grandes,
 * então a leitura segue por faixas (Range) até o tamanho total do Content-Range.
 */
async function fetchWhole(url: string): Promise<Blob> {
  const parts: Blob[] = [];
  let pos = 0;
  let total = Infinity;
  while (pos < total) {
    const res = await fetch(url, { headers: { Range: `bytes=${pos}-` } });
    if (res.status === 200) return res.blob();
    if (res.status !== 206) throw new Error(`imagem não encontrada (${res.status})`);
    const size = /\/(\d+)\s*$/.exec(res.headers.get("Content-Range") ?? "");
    if (!size) throw new Error("resposta sem Content-Range");
    total = Number(size[1]);
    const part = await res.blob();
    if (part.size === 0) throw new Error("leitura da imagem parou no meio");
    parts.push(part);
    pos += part.size;
  }
  return new Blob(parts);
}

/** Decodifica já girada pelo EXIF (foto de celular) e reduz se passar de MAX_IMAGE_SIDE. */
async function openImage(url: string): Promise<ImageBitmap> {
  const bitmap = await createImageBitmap(await fetchWhole(url), { imageOrientation: "from-image" });
  const longest = Math.max(bitmap.width, bitmap.height);
  if (longest <= MAX_IMAGE_SIDE) return bitmap;
  const k = MAX_IMAGE_SIDE / longest;
  try {
    return await createImageBitmap(bitmap, {
      resizeWidth: Math.max(1, Math.round(bitmap.width * k)),
      resizeHeight: Math.max(1, Math.round(bitmap.height * k)),
      resizeQuality: "high",
    });
  } finally {
    bitmap.close();
  }
}

export class PicturePool {
  /** Ordem de inserção = do menos para o mais recentemente usado. */
  private entries = new Map<string, Entry>();
  private sources: Record<string, PreviewSource> = {};

  setSources(sources: Record<string, PreviewSource>): void {
    this.sources = sources;
    for (const [key, entry] of this.entries) {
      const mediaId = key.split(":")[0]!;
      if (sources[mediaId]?.url !== entry.url) void this.evict(key);
    }
  }

  /**
   * Imagem da mídia no tempo `sourceUs`. `slot` separa usos simultâneos da mesma mídia
   * num mesmo quadro (o mesmo vídeo em duas trilhas). O quadro devolvido pertence ao pool
   * e vale até o próximo pedido do mesmo slot.
   */
  async picture(mediaId: string, sourceUs: Us, slot = 0): Promise<Picture | null> {
    const source = this.sources[mediaId];
    if (!source || source.kind === "audio") return null;
    const key = `${mediaId}:${slot}`;
    let entry = this.entries.get(key);
    if (entry) {
      this.entries.delete(key);
      this.entries.set(key, entry);
    } else {
      entry =
        source.kind === "image"
          ? { kind: "image", url: source.url, ready: openImage(source.url) }
          : { kind: "video", url: source.url, ready: openVideo(source.url), cursor: null, last: -1 };
      this.entries.set(key, entry);
      await this.trim();
    }

    if (entry.kind === "image") {
      const bitmap = await entry.ready;
      return { image: bitmap, width: bitmap.width, height: bitmap.height, rotation: 0 };
    }

    const { track, config, firstTs, rotation } = await entry.ready;
    const t = sourceUs + firstTs;
    if (!entry.cursor || t < entry.last || t > entry.last + JUMP_US) {
      await entry.cursor?.close();
      entry.cursor = new FrameCursor(decodeFrames(track, config, t, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY));
    }
    entry.last = t;
    const frame = await entry.cursor.frameAt(t);
    return frame ? { image: frame, width: frame.displayWidth, height: frame.displayHeight, rotation } : null;
  }

  /** Solta os quadros guardados (o contador de VideoFrames volta a zero), mantendo os arquivos abertos. */
  async releaseFrames(): Promise<void> {
    for (const entry of this.entries.values()) {
      if (entry.kind === "video" && entry.cursor) {
        await entry.cursor.close();
        entry.cursor = null;
      }
    }
  }

  async closeAll(): Promise<void> {
    for (const key of [...this.entries.keys()]) await this.evict(key);
  }

  private async trim(): Promise<void> {
    while (this.entries.size > MAX_DECODERS) {
      const oldest = this.entries.keys().next().value!;
      await this.evict(oldest);
    }
  }

  private async evict(key: string): Promise<void> {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.entries.delete(key);
    try {
      if (entry.kind === "image") (await entry.ready).close();
      else {
        await entry.cursor?.close();
        (await entry.ready).input.dispose();
      }
    } catch {
      // Falhou ao abrir: nada para fechar.
    }
  }
}
