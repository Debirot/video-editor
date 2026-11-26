/**
 * Valores padrão, migrações de schema e serialização do projeto.
 *
 * normalizeProject é a única porta de entrada de um project.json lido do disco:
 * valida o essencial, preenche campos omitidos e migra versões antigas.
 */
import { newId } from "@/lib/ids";
import { relativePath } from "@/lib/paths";
import {
  CURRENT_SCHEMA_VERSION,
  type Clip,
  type ColorAdjust,
  type Crop,
  type Media,
  type Project,
  type ProjectSettings,
  type Track,
  type TrackKind,
  type Transform,
} from "./types";

export class ProjectFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectFormatError";
  }
}

export const DEFAULT_SETTINGS: ProjectSettings = {
  width: 1920,
  height: 1080,
  fps: { num: 30, den: 1 },
  sampleRate: 48000,
  background: "#000000",
};

export const DEFAULT_TRANSFORM: Transform = { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 };
export const DEFAULT_CROP: Crop = { left: 0, top: 0, right: 0, bottom: 0 };
export const DEFAULT_COLOR: ColorAdjust = {
  exposure: 0,
  brightness: 0,
  contrast: 0,
  saturation: 0,
  temperature: 0,
};

export function createTrack(kind: TrackKind, name: string): Track {
  return {
    id: newId("t"),
    kind,
    name,
    hidden: false,
    muted: false,
    locked: false,
    solo: false,
    gainDb: 0,
    clips: [],
    transitions: [],
  };
}

/** Projeto novo com duas trilhas de vídeo e duas de áudio. */
export function createProject(name: string, settings: Partial<ProjectSettings> = {}): Project {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: newId("p"),
    name,
    settings: { ...DEFAULT_SETTINGS, ...settings },
    bins: [],
    media: [],
    tracks: [
      createTrack("video", "V1"),
      createTrack("video", "V2"),
      createTrack("audio", "A1"),
      createTrack("audio", "A2"),
    ],
    markers: [],
  };
}

type Raw = Record<string, unknown>;

function isObject(v: unknown): v is Raw {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function req<T>(cond: T, what: string): asserts cond {
  if (!cond) throw new ProjectFormatError(`project.json inválido: ${what}`);
}

function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function normalizeClip(raw: unknown): Clip {
  req(isObject(raw), "clipe não é um objeto");
  req(typeof raw.id === "string", "clipe sem id");
  req(Number.isInteger(raw.start) && Number.isInteger(raw.duration), `clipe ${raw.id} com tempos não inteiros`);
  const clip = { ...raw } as unknown as Clip;
  clip.kind ??= "media";
  clip.sourceIn ??= 0;
  clip.speed ??= 1;
  clip.enabled ??= true;
  clip.transform = { ...DEFAULT_TRANSFORM, ...(isObject(raw.transform) ? raw.transform : {}) };
  clip.crop = { ...DEFAULT_CROP, ...(isObject(raw.crop) ? raw.crop : {}) };
  clip.color = { ...DEFAULT_COLOR, ...(isObject(raw.color) ? raw.color : {}) };
  clip.effects = arr(raw.effects) as Clip["effects"];
  clip.keyframes = isObject(raw.keyframes) ? (raw.keyframes as Clip["keyframes"]) : {};
  return clip;
}

function normalizeTrack(raw: unknown): Track {
  req(isObject(raw), "trilha não é um objeto");
  req(typeof raw.id === "string", "trilha sem id");
  req(raw.kind === "video" || raw.kind === "audio" || raw.kind === "subtitle", `trilha ${raw.id} com tipo inválido`);
  const clips = arr(raw.clips).map(normalizeClip).sort((a, b) => a.start - b.start);
  return {
    id: raw.id,
    kind: raw.kind,
    name: typeof raw.name === "string" ? raw.name : "",
    hidden: raw.hidden === true,
    muted: raw.muted === true,
    locked: raw.locked === true,
    solo: raw.solo === true,
    gainDb: typeof raw.gainDb === "number" ? raw.gainDb : 0,
    clips,
    transitions: arr(raw.transitions) as Track["transitions"],
  };
}

function normalizeMedia(raw: unknown): Media {
  req(isObject(raw), "mídia não é um objeto");
  req(typeof raw.id === "string", "mídia sem id");
  req(typeof raw.path === "string", `mídia ${raw.id} sem caminho`);
  req(isObject(raw.probe), `mídia ${raw.id} sem probe`);
  const media = { ...raw } as unknown as Media;
  media.relPath ??= null;
  media.binId ??= null;
  media.proxy = isObject(raw.proxy) ? (raw.proxy as Media["proxy"]) : { status: "none" };
  media.fingerprint ??= { size: 0, mtime: 0, partialHash: "" };
  delete media.missing;
  return media;
}

/**
 * Migrações: cada entrada leva um projeto da versão N para N + 1.
 * Para criar a versão 2: adicionar MIGRATIONS[1] e subir CURRENT_SCHEMA_VERSION.
 */
const MIGRATIONS: Record<number, (raw: Raw) => Raw> = {};

export function normalizeProject(input: unknown): Project {
  req(isObject(input), "o conteúdo não é um objeto");
  let raw: Raw = input;
  let version = raw.schemaVersion;
  req(Number.isInteger(version), "schemaVersion ausente");
  if ((version as number) > CURRENT_SCHEMA_VERSION) {
    throw new ProjectFormatError(
      `Este projeto foi salvo por uma versão mais nova do editor (schema ${version}).`,
    );
  }
  while ((version as number) < CURRENT_SCHEMA_VERSION) {
    const migrate = MIGRATIONS[version as number];
    req(migrate, `sem migração da versão ${version}`);
    raw = migrate(raw);
    version = raw.schemaVersion;
  }

  req(typeof raw.id === "string", "projeto sem id");
  const settingsRaw = isObject(raw.settings) ? raw.settings : {};
  const settings: ProjectSettings = { ...DEFAULT_SETTINGS, ...(settingsRaw as Partial<ProjectSettings>) };
  req(
    Number.isInteger(settings.fps.num) && Number.isInteger(settings.fps.den) && settings.fps.num > 0 && settings.fps.den > 0,
    "FPS inválido",
  );

  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: raw.id,
    name: typeof raw.name === "string" ? raw.name : "Sem título",
    settings,
    bins: arr(raw.bins) as Project["bins"],
    media: arr(raw.media).map(normalizeMedia),
    tracks: arr(raw.tracks).map(normalizeTrack),
    markers: arr(raw.markers) as Project["markers"],
  };
}

/**
 * Texto gravado em project.json. Remove campos calculados ao abrir e, com `dir`
 * (pasta do projeto), atualiza o `relPath` de cada mídia para religar depois.
 */
export function serializeProject(project: Project, dir?: string): string {
  const media = project.media.map((m) => {
    const copy = { ...m };
    delete copy.missing;
    if (dir) copy.relPath = relativePath(dir, m.path);
    return copy;
  });
  return JSON.stringify({ ...project, media }, null, 2);
}
