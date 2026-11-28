/**
 * Composição de um quadro do projeto. O preview (playback.ts) e a exportação
 * (exportProject.ts) chamam estas mesmas funções: o arquivo final sai igual ao preview.
 */
import type { Compositor } from "./compositor/compositor";
import { placeLayer, type Size } from "./transform";
import type { PicturePool, Picture } from "./decode/pool";
import type { VideoLayer } from "./evaluate";
import { shapeImage, shapeSize } from "./shapes";

/**
 * Busca as imagens de todas as camadas antes de desenhar (o quadro aparece inteiro).
 * Usos simultâneos da mesma mídia no mesmo quadro vão para slots diferentes do pool.
 * Falha numa camada vira null e é informada por `onError` (a camada fica de fora).
 * Formas não vêm do pool (null aqui): são desenhadas em drawLayers.
 */
export async function gatherPictures(
  pool: PicturePool,
  layers: VideoLayer[],
  onError: (mediaId: string, error: unknown) => void,
): Promise<(Picture | null)[]> {
  const used = new Map<string, number>();
  const pictures: (Picture | null)[] = [];
  for (const layer of layers) {
    if (layer.kind === "shape") {
      pictures.push(null);
      continue;
    }
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

/**
 * Desenha as camadas de baixo para cima sobre o fundo do projeto, cada uma com a sua
 * transformação e recorte. `project` é o tamanho do projeto (a posição é em px dele);
 * o compositor pode ser menor (preview em 1/2, 1/4) ou de outro tamanho (exportação).
 */
export function drawLayers(
  c: Compositor,
  background: string,
  project: Size,
  layers: VideoLayer[],
  pictures: (Picture | null)[],
): void {
  c.clear(background);
  const out = { width: c.width, height: c.height };
  layers.forEach((layer, i) => {
    if (layer.opacity <= 0) return;
    if (layer.kind === "shape") {
      const image = shapeImage(layer.shape, out.width / project.width, layer.transform.scale);
      const placement = placeLayer(shapeSize(layer.shape), out, project, layer.transform, layer.crop);
      c.drawPlaced(image, placement, layer.opacity, true);
      return;
    }
    const pic = pictures[i];
    if (!pic) return;
    const placement = placeLayer(pic, out, project, layer.transform, layer.crop);
    const blend = layer.kind === "image" || layer.opacity < 1;
    c.drawPlaced(pic.image, placement, layer.opacity, blend);
  });
}
