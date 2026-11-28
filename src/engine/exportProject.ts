/**
 * Exporta o projeto: a mesma composição do preview (compose.ts), sempre com os originais,
 * quadro a quadro sem descartar nada, e o áudio mixado em 48 kHz estéreo (mix.ts).
 * Decodificadores próprios (não divide com o preview), fechados no fim, inclusive em erro.
 */
import type { Project } from "@/project/types";
import { projectDuration } from "@/project/queries";
import { AudioPool } from "./audio/decode";
import { clampInPlace, mixInto, silence } from "./audio/mix";
import { drawLayers, gatherPictures } from "./compose";
import { PicturePool } from "./decode/pool";
import { audioSegmentsIn, videoLayersAt } from "./evaluate";
import { runExport } from "./export";
import type { ExportResult, ExportSettings, OutputRef, PreviewSource } from "./messages";

export async function exportProject(
  project: Project,
  sources: Record<string, PreviewSource>,
  settings: ExportSettings,
  target: OutputRef,
  signal: AbortSignal,
  onProgress: (done: number, total: number) => void,
): Promise<ExportResult> {
  const pictures = new PicturePool();
  const audio = new AudioPool();
  pictures.setSources(sources);
  audio.setSources(sources);

  const fail = (mediaId: string, e: unknown): never => {
    const name = project.media.find((m) => m.id === mediaId)?.path ?? mediaId;
    throw new Error(`não foi possível ler ${name}: ${e instanceof Error ? e.message : String(e)}`);
  };

  try {
    const { result } = await runExport({
      target,
      settings: { ...settings, durationUs: projectDuration(project) },
      signal,
      onProgress,
      render: async (t, compositor) => {
        const layers = videoLayersAt(project, t);
        // Na exportação uma mídia ilegível é erro (no preview a camada só some).
        const pics = await gatherPictures(pictures, layers, fail);
        drawLayers(compositor, project.settings.background, project.settings, layers, pics);
      },
      audio: async (from, to) => {
        const out = silence(from, to);
        for (const seg of audioSegmentsIn(project, from, to)) {
          const chunk = await audio.render(seg);
          if (chunk) mixInto(out, from, chunk);
        }
        clampInPlace(out);
        return out;
      },
    });
    return result;
  } finally {
    await pictures.closeAll();
    audio.setSources({});
  }
}
