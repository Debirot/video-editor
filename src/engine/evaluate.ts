/**
 * O que aparece no instante t: camadas de vídeo de baixo para cima.
 * Função pura sobre o projeto (roda no Worker, testada em Node).
 * Transformações, efeitos, textos e transições entram aqui na Fase 2.
 */
import { frameToUs, usToFrame, type Rational, type Us } from "@/lib/time";
import { clipAt, sourceTimeAt } from "@/project/queries";
import type { Id, Project } from "@/project/types";

export interface VideoLayer {
  clipId: Id;
  mediaId: Id;
  kind: "video" | "image";
  /** Tempo na fonte (µs desde o início da mídia). */
  sourceTime: Us;
  opacity: number;
}

/** Início do quadro do projeto que contém t. */
export function frameStart(t: Us, fps: Rational): Us {
  return frameToUs(usToFrame(t, fps), fps);
}

/** Camadas visíveis em t: trilhas de vídeo na ordem do projeto (índice 0 por baixo). */
export function videoLayersAt(project: Project, t: Us): VideoLayer[] {
  const media = new Map(project.media.map((m) => [m.id, m]));
  const layers: VideoLayer[] = [];
  for (const track of project.tracks) {
    if (track.kind !== "video" || track.hidden) continue;
    const clip = clipAt(track, t);
    if (!clip || !clip.enabled || !clip.mediaId || (clip.kind !== "media" && clip.kind !== "freeze")) continue;
    const m = media.get(clip.mediaId);
    if (!m || m.missing || m.kind === "audio") continue;
    const last = Math.max(0, m.probe.duration - 1);
    layers.push({
      clipId: clip.id,
      mediaId: m.id,
      kind: m.kind,
      sourceTime: m.kind === "image" ? 0 : Math.min(Math.max(0, sourceTimeAt(clip, t)), last),
      opacity: clip.transform.opacity,
    });
  }
  return layers;
}
