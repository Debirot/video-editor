/**
 * Composição de um quadro do projeto. O preview (playback.ts) e a exportação
 * (exportProject.ts) chamam estas mesmas funções: o arquivo final sai igual ao preview.
 */
import type { Compositor } from "./compositor/compositor";
import { fitContain } from "./compositor/compositor";
import type { PicturePool, Picture } from "./decode/pool";
import type { VideoLayer } from "./evaluate";

/**
 * Busca as imagens de todas as camadas antes de desenhar (o quadro aparece inteiro).
 * Usos simultâneos da mesma mídia no mesmo quadro vão para slots diferentes do pool.
 * Falha numa camada vira null e é informada por `onError` (a camada fica de fora).
 */
export async function gatherPictures(
  pool: PicturePool,
  layers: VideoLayer[],
  onError: (mediaId: string, error: unknown) => void,
): Promise<(Picture | null)[]> {
  const used = new Map<string, number>();
  const pictures: (Picture | null)[] = [];
  for (const layer of layers) {
    const slot = used.get(layer.mediaId) ?? 0;
    used.set(layer.mediaId, slot + 1);
    try {
      pictures.push(await pool.picture(layer.mediaId, layer.sourceTime, slot));
    } catch (e) {
      pictures.push(null);
      onError(layer.mediaId, e);
    }
  }
  return pictures;
}

/** Desenha as camadas de baixo para cima sobre o fundo do projeto. */
export function drawLayers(c: Compositor, background: string, layers: VideoLayer[], pictures: (Picture | null)[]): void {
  c.clear(background);
  layers.forEach((layer, i) => {
    const pic = pictures[i];
    if (!pic) return;
    c.drawFrame(pic.image, fitContain(pic.width, pic.height, c.width, c.height), layer.opacity, layer.kind === "image");
  });
}
