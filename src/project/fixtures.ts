/**
 * Projetos montados em código para testes. Não é importado pelo app.
 */
import { DEFAULT_COLOR, DEFAULT_CROP, DEFAULT_TRANSFORM } from "./normalize";
import type { Clip, Project } from "./types";

export function makeClip(partial: Partial<Clip> & Pick<Clip, "id" | "start" | "duration">): Clip {
  return {
    kind: "media",
    mediaId: "m_a",
    sourceIn: 0,
    speed: 1,
    enabled: true,
    transform: { ...DEFAULT_TRANSFORM },
    crop: { ...DEFAULT_CROP },
    color: { ...DEFAULT_COLOR },
    effects: [],
    keyframes: {},
    ...partial,
  };
}

/** Uma trilha de vídeo com três clipes (0–2 s, 2–5 s, 6–8 s) e uma de áudio vazia. */
export function makeSmallProject(): Project {
  return {
    schemaVersion: 1,
    id: "p_test",
    name: "Teste",
    settings: { width: 1920, height: 1080, fps: { num: 30, den: 1 }, sampleRate: 48000, background: "#000000" },
    bins: [],
    media: [
      {
        id: "m_a",
        kind: "video",
        path: "/videos/a.mp4",
        relPath: null,
        fingerprint: { size: 1000, mtime: 1, partialHash: "aaaa" },
        probe: { duration: 60_000_000, width: 1920, height: 1080, fps: { num: 30, den: 1 } },
        proxy: { status: "none" },
        binId: null,
      },
    ],
    tracks: [
      {
        id: "t_v1",
        kind: "video",
        name: "V1",
        hidden: false,
        muted: false,
        locked: false,
        solo: false,
        gainDb: 0,
        clips: [
          makeClip({ id: "c_1", start: 0, duration: 2_000_000 }),
          makeClip({ id: "c_2", start: 2_000_000, duration: 3_000_000, sourceIn: 10_000_000 }),
          makeClip({ id: "c_3", start: 6_000_000, duration: 2_000_000, speed: 2 }),
        ],
        transitions: [],
      },
      {
        id: "t_a1",
        kind: "audio",
        name: "A1",
        hidden: false,
        muted: false,
        locked: false,
        solo: false,
        gainDb: 0,
        clips: [],
        transitions: [],
      },
    ],
    markers: [],
  };
}
