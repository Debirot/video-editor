/**
 * Comandos sobre trilhas. Cada função devolve uma Recipe para applyCommand.
 */
import type { Recipe } from "../history";
import { createTrack } from "../normalize";
import type { Id, TrackKind } from "../types";

/**
 * Adiciona trilha. Vídeo entra acima da última trilha de vídeo
 * (índice maior = mais alto na composição); áudio entra por último.
 */
export function addTrack(kind: TrackKind, name?: string): Recipe {
  return (draft) => {
    const count = draft.tracks.filter((t) => t.kind === kind).length;
    const prefix = kind === "video" ? "V" : kind === "audio" ? "A" : "L";
    const track = createTrack(kind, name ?? `${prefix}${count + 1}`);
    if (kind === "video") {
      let lastVideo = -1;
      draft.tracks.forEach((t, i) => {
        if (t.kind === "video") lastVideo = i;
      });
      draft.tracks.splice(lastVideo + 1, 0, track);
    } else {
      draft.tracks.push(track);
    }
  };
}

export function removeTrack(trackId: Id): Recipe {
  return (draft) => {
    const i = draft.tracks.findIndex((t) => t.id === trackId);
    if (i >= 0) draft.tracks.splice(i, 1);
  };
}

export function renameTrack(trackId: Id, name: string): Recipe {
  return (draft) => {
    const track = draft.tracks.find((t) => t.id === trackId);
    if (track) track.name = name;
  };
}

export type TrackFlag = "hidden" | "muted" | "locked" | "solo";

export function setTrackFlag(trackId: Id, flag: TrackFlag, value: boolean): Recipe {
  return (draft) => {
    const track = draft.tracks.find((t) => t.id === trackId);
    if (track) track[flag] = value;
  };
}

export function setTrackGain(trackId: Id, gainDb: number): Recipe {
  return (draft) => {
    const track = draft.tracks.find((t) => t.id === trackId);
    if (track) track.gainDb = Math.max(-60, Math.min(12, gainDb));
  };
}
