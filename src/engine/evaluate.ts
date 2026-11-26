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

/** Um trecho de áudio a tocar: parte de um clipe dentro do intervalo pedido. */
export interface AudioSegment {
  clipId: Id;
  mediaId: Id;
  /** Início e fim na timeline (µs). */
  start: Us;
  end: Us;
  /** Tempo na fonte correspondente a `start`. */
  sourceStart: Us;
  speed: number;
  /** Ganho linear (trilha + clipe). */
  gain: number;
  /** Início e fim do clipe inteiro e fades, para o envelope de volume. */
  clipStart: Us;
  clipEnd: Us;
  fadeIn: Us;
  fadeOut: Us;
}

export function dbToGain(db: number): number {
  return db <= -60 ? 0 : 10 ** (db / 20);
}

/**
 * Trechos de áudio em [from, to): clipes das trilhas de áudio, respeitando mudo e solo
 * (se alguma trilha está em solo, só as em solo tocam). Clipes de trilhas de vídeo não
 * tocam som; o áudio de um vídeo vem do clipe de áudio ligado.
 */
export function audioSegmentsIn(project: Project, from: Us, to: Us): AudioSegment[] {
  const media = new Map(project.media.map((m) => [m.id, m]));
  const audioTracks = project.tracks.filter((t) => t.kind === "audio");
  const anySolo = audioTracks.some((t) => t.solo);
  const out: AudioSegment[] = [];
  for (const track of audioTracks) {
    if (track.muted || (anySolo && !track.solo)) continue;
    for (const clip of track.clips) {
      const end = clip.start + clip.duration;
      if (end <= from || clip.start >= to || !clip.enabled || !clip.mediaId) continue;
      const m = media.get(clip.mediaId);
      if (!m || m.missing || !m.probe.audioCodec) continue;
      const gain = dbToGain(track.gainDb + (clip.audio?.gainDb ?? 0));
      if (gain === 0) continue;
      const start = Math.max(clip.start, from);
      out.push({
        clipId: clip.id,
        mediaId: m.id,
        start,
        end: Math.min(end, to),
        sourceStart: sourceTimeAt(clip, start),
        speed: clip.speed,
        gain,
        clipStart: clip.start,
        clipEnd: end,
        fadeIn: clip.audio?.fadeIn ?? 0,
        fadeOut: clip.audio?.fadeOut ?? 0,
      });
    }
  }
  return out;
}
