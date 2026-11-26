/**
 * Comandos sobre clipes. T1.05 traz só "adicionar ao fim"; mover, aparar,
 * dividir e apagar entram em T1.06.
 */
import { newId } from "@/lib/ids";
import { frameToUs, snapToFrame, usToFrame, type Rational } from "@/lib/time";
import type { Draft } from "immer";
import type { Recipe } from "../history";
import { DEFAULT_COLOR, DEFAULT_CROP, DEFAULT_TRANSFORM } from "../normalize";
import { clipEnd } from "../queries";
import type { Clip, Media, Track } from "../types";

/** Duração padrão de uma imagem colocada na timeline. */
export const IMAGE_DURATION_SECONDS = 5;

export function createClip(fields: Pick<Clip, "id" | "kind" | "start" | "duration"> & Partial<Clip>): Clip {
  return {
    sourceIn: 0,
    speed: 1,
    enabled: true,
    transform: { ...DEFAULT_TRANSFORM },
    crop: { ...DEFAULT_CROP },
    color: { ...DEFAULT_COLOR },
    effects: [],
    keyframes: {},
    ...fields,
  };
}

function trackEnd(track: Draft<Track> | undefined): number {
  const last = track?.clips[track.clips.length - 1];
  return last ? clipEnd(last) : 0;
}

/**
 * Coloca a mídia no fim da primeira trilha livre (não travada) do tipo certo.
 * Vídeo com áudio vira dois clipes ligados (linkGroup), que começam juntos no
 * maior dos dois fins, para nenhum dos dois sobrepor o que já existe.
 * A duração é arredondada para baixo ao quadro do projeto.
 */
export function appendMediaClip(media: Media, fps: Rational): Recipe {
  // Ids gerados fora da recipe: refazer reaplica os mesmos patches.
  const videoId = newId("c");
  const audioId = newId("c");
  const group = newId("g");

  return (draft) => {
    const wantsVideo = media.kind === "video" || media.kind === "image";
    const wantsAudio = media.kind === "audio" || (media.kind === "video" && !!media.probe.audioCodec);
    const videoTrack = wantsVideo ? draft.tracks.find((t) => t.kind === "video" && !t.locked) : undefined;
    const audioTrack = wantsAudio ? draft.tracks.find((t) => t.kind === "audio" && !t.locked) : undefined;
    if (wantsVideo && !videoTrack) return;
    if (!videoTrack && !audioTrack) return;

    const frames =
      media.kind === "image"
        ? IMAGE_DURATION_SECONDS * Math.round(fps.num / fps.den)
        : usToFrame(media.probe.duration, fps);
    const duration = frameToUs(frames, fps);
    if (duration <= 0) return;

    const start = snapToFrame(Math.max(trackEnd(videoTrack), trackEnd(audioTrack)), fps);
    const linked = !!videoTrack && !!audioTrack;
    const common = { start, duration, mediaId: media.id, ...(linked ? { linkGroup: group } : {}) };

    videoTrack?.clips.push(createClip({ id: videoId, kind: "media", ...common }));
    audioTrack?.clips.push(
      createClip({ id: audioId, kind: "media", ...common, audio: { gainDb: 0, fadeIn: 0, fadeOut: 0 } }),
    );
  };
}
