/**
 * Abre uma mídia com o Mediabunny sem carregar o arquivo inteiro na memória.
 * Com URL, o Mediabunny lê por faixas de bytes (Range) pelo protocolo media://.
 */
import { ALL_FORMATS, BlobSource, Input, UrlSource, type InputVideoTrack } from "mediabunny";
import type { MediaRef } from "../messages";

export function openInput(ref: MediaRef): Input {
  const source =
    ref.kind === "url"
      ? new UrlSource(ref.url, { maxCacheSize: 32 * 2 ** 20, parallelism: 2 })
      : new BlobSource(ref.file);
  return new Input({ formats: ALL_FORMATS, source });
}

export async function primaryVideoTrack(input: Input): Promise<InputVideoTrack> {
  const track = await input.getPrimaryVideoTrack();
  if (!track) throw new Error("O arquivo não tem trilha de vídeo.");
  return track;
}
