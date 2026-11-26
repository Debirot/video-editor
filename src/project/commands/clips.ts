/**
 * Comandos sobre clipes. Todos mantêm as invariantes das trilhas: clipes
 * ordenados por start, sem sobreposição, tempos inteiros (queries.trackProblems).
 * Mover e aparar com o mouse entram em T1.06b, sobre clearRange e trimClip.
 */
import { newId } from "@/lib/ids";
import { frameToUs, snapToFrame, usToFrame, type Rational } from "@/lib/time";
import { current, isDraft, type Draft } from "immer";
import type { Recipe } from "../history";
import { DEFAULT_COLOR, DEFAULT_CROP, DEFAULT_TRANSFORM } from "../normalize";
import { clipEnd } from "../queries";
import type { Clip, Id, Media, Project, Track, Us } from "../types";

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

// ─── Primitivas ──────────────────────────────────────────────────────────────

/** Desloca keyframes para um novo início relativo e descarta os que ficam fora de [0, duration]. */
function shiftKeyframes(clip: Clip, offset: Us, duration: Us): Clip["keyframes"] {
  const out: Clip["keyframes"] = {};
  for (const [prop, list] of Object.entries(clip.keyframes)) {
    const kept = list.map((k) => ({ ...k, t: k.t - offset })).filter((k) => k.t >= 0 && k.t <= duration);
    if (kept.length > 0) out[prop] = kept;
  }
  return out;
}

/**
 * Corta o clipe no instante t (start < t < fim) e devolve as duas metades.
 * A da direita recebe `rightId`, começa na fonte onde a esquerda parou
 * (sourceIn + (t − start) × speed) e herda o fade de saída; a esquerda fica com o de entrada.
 */
export function cutClip(input: Clip, t: Us, rightId: Id): [Clip, Clip] {
  // Dentro de uma recipe o clipe é um rascunho do Immer, que structuredClone não copia.
  const clip = isDraft(input) ? current(input) : input;
  const offset = t - clip.start;
  const leftDuration = offset;
  const rightDuration = clip.duration - offset;
  const left: Clip = {
    ...structuredClone(clip),
    duration: leftDuration,
    keyframes: shiftKeyframes(clip, 0, leftDuration),
    ...(clip.audio ? { audio: { ...clip.audio, fadeOut: 0 } } : {}),
  };
  const right: Clip = {
    ...structuredClone(clip),
    id: rightId,
    start: t,
    duration: rightDuration,
    sourceIn: clip.kind === "freeze" ? clip.sourceIn : clip.sourceIn + Math.round(offset * clip.speed),
    keyframes: shiftKeyframes(clip, offset, rightDuration),
    ...(clip.audio ? { audio: { ...clip.audio, fadeIn: 0 } } : {}),
  };
  return [left, right];
}

/** Insere mantendo a ordem por start. */
export function insertClip(track: Track, clip: Clip): void {
  const i = track.clips.findIndex((c) => c.start > clip.start);
  if (i < 0) track.clips.push(clip);
  else track.clips.splice(i, 0, clip);
}

function dropTransitions(track: Track, removed: Set<Id>): void {
  track.transitions = track.transitions.filter((x) => !removed.has(x.fromClipId) && !removed.has(x.toClipId));
}

/**
 * Libera o intervalo [from, to) numa trilha: remove o que está dentro, apara o que
 * encosta e corta em dois o que atravessa. Base de colar e (T1.06b) de soltar clipes.
 */
export function clearRange(track: Track, from: Us, to: Us, newId_: () => Id = () => newId("c")): void {
  if (to <= from) return;
  const removed = new Set<Id>();
  const next: Clip[] = [];
  for (const c of track.clips) {
    const end = clipEnd(c);
    if (end <= from || c.start >= to) {
      next.push(c);
    } else if (c.start >= from && end <= to) {
      removed.add(c.id);
    } else if (c.start < from && end > to) {
      const [left, rest] = cutClip(c, from, "_tmp");
      const [, right] = cutClip(rest, to, newId_());
      next.push(left, right);
    } else if (c.start < from) {
      next.push(cutClip(c, from, "_tmp")[0]);
    } else {
      next.push(cutClip(c, to, c.id)[1]);
    }
  }
  track.clips = next;
  dropTransitions(track, removed);
}

function findClipIn(project: Project, id: Id): { track: Track; clip: Clip } | undefined {
  for (const track of project.tracks) {
    const clip = track.clips.find((c) => c.id === id);
    if (clip) return { track, clip };
  }
  return undefined;
}

// ─── Comandos ────────────────────────────────────────────────────────────────

/**
 * Divide no instante t os clipes indicados que o atravessam (inclua os ligados na
 * lista; ver queries.withLinked). Clipes em trilha travada ou sem t no meio ficam
 * como estão. As metades da direita de clipes ligados continuam ligadas entre si.
 * `rightIds` dá o id de cada metade nova (por id do clipe original).
 */
export function splitClips(ids: Id[], t: Us, rightIds: Record<Id, Id>): Recipe {
  return (draft) => {
    const groups = new Map<Id, Id>();
    for (const id of ids) {
      const found = findClipIn(draft as Project, id);
      if (!found || found.track.locked) continue;
      const { track, clip } = found;
      if (t <= clip.start || t >= clipEnd(clip)) continue;
      const [left, right] = cutClip(clip, t, rightIds[id] ?? newId("c"));
      if (clip.linkGroup) {
        if (!groups.has(clip.linkGroup)) groups.set(clip.linkGroup, newId("g"));
        right.linkGroup = groups.get(clip.linkGroup);
      }
      const i = track.clips.indexOf(clip);
      track.clips.splice(i, 1, left, right);
      // A transição que saía deste clipe agora sai da metade da direita.
      for (const x of track.transitions) if (x.fromClipId === clip.id) x.fromClipId = right.id;
    }
  };
}

/**
 * Apaga clipes. Com `ripple`, os clipes seguintes de cada trilha afetada andam para
 * trás o quanto foi apagado antes deles (as outras trilhas não se movem).
 */
export function deleteClips(ids: Id[], ripple = false): Recipe {
  const remove = new Set(ids);
  return (draft) => {
    for (const track of draft.tracks) {
      if (track.locked || !track.clips.some((c) => remove.has(c.id))) continue;
      let shift = 0;
      const kept: Clip[] = [];
      for (const c of track.clips) {
        if (remove.has(c.id)) {
          shift += c.duration;
          continue;
        }
        if (ripple && shift > 0) c.start -= shift;
        kept.push(c);
      }
      track.clips = kept;
      dropTransitions(track as Track, remove);
    }
  };
}

/** Um clipe copiado, com a trilha de onde veio. */
export interface ClipboardEntry {
  trackId: Id;
  clip: Clip;
}

/** Copia clipes (com a trilha de cada um) para a área de transferência do app. */
export function copyClips(project: Project, ids: Id[]): ClipboardEntry[] {
  const out: ClipboardEntry[] = [];
  for (const id of ids) {
    const found = findClipIn(project, id);
    if (found) out.push({ trackId: found.track.id, clip: structuredClone(found.clip) });
  }
  return out.sort((a, b) => a.clip.start - b.clip.start);
}

/**
 * Cola na posição `at` (o primeiro clipe copiado cai em `at`, os outros mantêm a
 * distância entre si), cada um na trilha de origem. Sobrescreve o que estiver no
 * caminho. Trilha que sumiu, travou ou mudou de tipo é pulada.
 * `newIds[i]` é o id do clipe colado a partir de entries[i].
 */
export function pasteClips(entries: ClipboardEntry[], at: Us, newIds: Id[]): Recipe {
  return (draft) => {
    if (entries.length === 0) return;
    const base = Math.min(...entries.map((e) => e.clip.start));
    const groups = new Map<Id, Id>();
    entries.forEach((entry, i) => {
      const track = draft.tracks.find((t) => t.id === entry.trackId);
      if (!track || track.locked) return;
      const start = at + (entry.clip.start - base);
      const clip: Clip = { ...structuredClone(entry.clip), id: newIds[i] ?? newId("c"), start };
      if (entry.clip.linkGroup) {
        if (!groups.has(entry.clip.linkGroup)) groups.set(entry.clip.linkGroup, newId("g"));
        clip.linkGroup = groups.get(entry.clip.linkGroup);
      }
      clearRange(track as Track, start, start + clip.duration);
      insertClip(track as Track, clip);
    });
  };
}
