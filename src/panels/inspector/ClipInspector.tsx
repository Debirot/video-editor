/**
 * Inspetor de um clipe (com o clipe ligado, se houver): seções Clipe e Áudio.
 * Toda mudança passa por applyCommand; arrastar um rótulo vira um passo de desfazer.
 */
import { AudioLines, Film, Image as ImageIcon, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NumberField, formatDecimal, parseDecimal } from "@/components/ui/number-field";
import { formatTimecode, parseTimecode, snapToFrame, type Rational } from "@/lib/time";
import { baseName } from "@/lib/paths";
import { projectStore } from "@/project/store";
import { clipEnd, withLinked } from "@/project/queries";
import { moveClips, trimBounds, trimClips } from "@/project/commands/clips";
import {
  CLIP_GAIN_MAX_DB,
  CLIP_GAIN_MIN_DB,
  resetClipTransform,
  SCALE_MAX,
  SCALE_MIN,
  setClipAudio,
  setClipCrop,
  setClipTransform,
  type CropPatch,
  type TransformPatch,
} from "@/project/commands/clipProps";
import type { Clip, Media, Project, Track } from "@/project/types";
import { InspectorRow, InspectorSection } from "./InspectorSection";

const store = () => projectStore.getState();

/** Envolve um arrasto de rótulo numa transação (uma entrada no histórico). */
const scrubHandlers = (label: string) => ({
  onScrubStart: () => store().beginTransaction(label),
  onScrubEnd: () => store().commitTransaction(),
});

function TimecodeField({
  label,
  value,
  fps,
  onChange,
  disabled,
}: {
  label: string;
  value: number;
  fps: Rational;
  onChange: (us: number) => void;
  disabled?: boolean;
}) {
  const frame = Math.round(1_000_000 * fps.den / fps.num);
  return (
    <NumberField
      label={label}
      value={value}
      step={frame}
      min={0}
      format={(v) => formatTimecode(v, fps)}
      parse={(text) => parseTimecode(text, fps)}
      onChange={(v) => onChange(snapToFrame(v, fps))}
      disabled={disabled}
      {...scrubHandlers(label)}
    />
  );
}

const seconds = (us: number) => `${formatDecimal(us / 1_000_000, 2)} s`;
const parseSeconds = (text: string) => {
  const v = parseDecimal(text);
  return v === null ? null : Math.round(v * 1_000_000);
};

export function ClipInspector({ project, clips }: { project: Project; clips: { clip: Clip; track: Track }[] }) {
  const fps = project.settings.fps;
  // Principal: o de vídeo, se houver; o de áudio alimenta a seção Áudio.
  const main = clips.find((c) => c.track.kind === "video") ?? clips[0]!;
  const audio = clips.find((c) => c.track.kind === "audio" && c.clip.audio);
  const media: Media | undefined = project.media.find((m) => m.id === main.clip.mediaId);
  const locked = clips.some((c) => c.track.locked);
  const ids = withLinked(project, [main.clip.id]);
  const Icon = media?.kind === "audio" ? AudioLines : media?.kind === "image" ? ImageIcon : Film;

  const setStart = (t: number) => {
    const delta = t - main.clip.start;
    if (delta !== 0) store().applyCommand("Mover clipe", moveClips(ids, delta, null));
  };
  const setDuration = (d: number) => {
    const bounds = trimBounds(store().project, ids, "end", fps);
    if (!bounds) return;
    const end = Math.min(bounds[1], Math.max(bounds[0], main.clip.start + snapToFrame(d, fps)));
    if (end !== clipEnd(main.clip)) store().applyCommand("Aparar clipe", trimClips(ids, "end", end));
  };
  const setAudio = (label: string, patch: Parameters<typeof setClipAudio>[1]) =>
    audio && store().applyCommand(label, setClipAudio([audio.clip.id], patch));

  return (
    <>
      <header className="flex h-10 shrink-0 items-center gap-2 px-3">
        <Icon className="size-4 shrink-0 text-text-2" />
        <h2 className="truncate text-title font-semibold" title={media?.path}>
          {media ? baseName(media.path) : "Clipe"}
        </h2>
      </header>
      {locked && <p className="px-3 pb-2 text-label text-text-2">Trilha travada: destrave para editar.</p>}

      <InspectorSection title="Clipe">
        <TimecodeField label="Início" value={main.clip.start} fps={fps} onChange={setStart} disabled={locked} />
        <TimecodeField label="Duração" value={main.clip.duration} fps={fps} onChange={setDuration} disabled={locked} />
        <InspectorRow label="Na mídia">
          <span className="tabular text-text-2">
            {formatTimecode(main.clip.sourceIn, fps)}
            {main.clip.speed !== 1 && ` · ${Math.round(main.clip.speed * 100)}%`}
          </span>
        </InspectorRow>
        <InspectorRow label="Trilha">
          <span className="text-text-2">{clips.map((c) => c.track.name).join(" + ")}</span>
        </InspectorRow>
      </InspectorSection>

      {main.track.kind === "video" && <TransformSection clip={main.clip} disabled={locked} />}

      {audio?.clip.audio && (
        <InspectorSection title="Áudio">
          <NumberField
            label="Volume"
            value={audio.clip.audio.gainDb}
            step={0.5}
            min={CLIP_GAIN_MIN_DB}
            max={CLIP_GAIN_MAX_DB}
            format={(v) => (v <= CLIP_GAIN_MIN_DB ? "mudo" : `${v > 0 ? "+" : ""}${formatDecimal(v, 1)} dB`)}
            parse={parseDecimal}
            onChange={(v) => setAudio("Volume do clipe", { gainDb: v })}
            disabled={locked}
            {...scrubHandlers("Volume do clipe")}
          />
          <NumberField
            label="Fade de entrada"
            value={audio.clip.audio.fadeIn}
            step={100_000}
            min={0}
            max={audio.clip.duration}
            pxPerStep={3}
            format={seconds}
            parse={parseSeconds}
            onChange={(v) => setAudio("Fade de entrada", { fadeIn: v })}
            disabled={locked}
            {...scrubHandlers("Fade de entrada")}
          />
          <NumberField
            label="Fade de saída"
            value={audio.clip.audio.fadeOut}
            step={100_000}
            min={0}
            max={audio.clip.duration}
            pxPerStep={3}
            format={seconds}
            parse={parseSeconds}
            onChange={(v) => setAudio("Fade de saída", { fadeOut: v })}
            disabled={locked}
            {...scrubHandlers("Fade de saída")}
          />
        </InspectorSection>
      )}
    </>
  );
}

const pct = (v: number) => `${formatDecimal(v, 0)}%`;
const px = (v: number) => `${formatDecimal(v, 0)} px`;
const deg = (v: number) => `${formatDecimal(v, 1).replace(/,0$/, "")}°`;

function TransformSection({ clip, disabled }: { clip: Clip; disabled: boolean }) {
  const t = clip.transform;
  const k = clip.crop;
  const setT = (label: string, patch: TransformPatch) => store().applyCommand(label, setClipTransform([clip.id], patch));
  const setC = (patch: CropPatch) => store().applyCommand("Recorte", setClipCrop([clip.id], patch));
  const changed =
    t.x !== 0 || t.y !== 0 || t.scale !== 1 || t.rotation !== 0 || t.opacity !== 1 || k.left || k.right || k.top || k.bottom;

  return (
    <>
      <InspectorSection title="Transformação">
        <NumberField label="Posição X" value={t.x} step={1} format={px} parse={parseDecimal} onChange={(v) => setT("Mover na tela", { x: v })} disabled={disabled} {...scrubHandlers("Mover na tela")} />
        <NumberField label="Posição Y" value={t.y} step={1} format={px} parse={parseDecimal} onChange={(v) => setT("Mover na tela", { y: v })} disabled={disabled} {...scrubHandlers("Mover na tela")} />
        <NumberField
          label="Escala"
          value={Math.round(t.scale * 1000) / 10}
          step={1}
          min={SCALE_MIN * 100}
          max={SCALE_MAX * 100}
          format={pct}
          parse={parseDecimal}
          onChange={(v) => setT("Escala", { scale: v / 100 })}
          disabled={disabled}
          {...scrubHandlers("Escala")}
        />
        <NumberField label="Rotação" value={t.rotation} step={1} min={-3600} max={3600} format={deg} parse={parseDecimal} onChange={(v) => setT("Rotação", { rotation: v })} disabled={disabled} {...scrubHandlers("Rotação")} />
        <NumberField
          label="Opacidade"
          value={Math.round(t.opacity * 100)}
          step={1}
          min={0}
          max={100}
          format={pct}
          parse={parseDecimal}
          onChange={(v) => setT("Opacidade", { opacity: v / 100 })}
          disabled={disabled}
          {...scrubHandlers("Opacidade")}
        />
        {changed ? (
          <Button
            variant="ghost"
            size="sm"
            className="self-start"
            disabled={disabled}
            onClick={() => store().applyCommand("Redefinir transformação", resetClipTransform([clip.id]))}
          >
            <RotateCcw /> Redefinir
          </Button>
        ) : null}
      </InspectorSection>

      <InspectorSection title="Recorte" defaultOpen={!!(k.left || k.right || k.top || k.bottom)}>
        {(["left", "right", "top", "bottom"] as const).map((side) => (
          <NumberField
            key={side}
            label={{ left: "Esquerda", right: "Direita", top: "Cima", bottom: "Baixo" }[side]}
            value={Math.round(k[side] * 100)}
            step={1}
            min={0}
            max={99}
            format={pct}
            parse={parseDecimal}
            onChange={(v) => setC({ [side]: v / 100 })}
            disabled={disabled}
            {...scrubHandlers("Recorte")}
          />
        ))}
      </InspectorSection>
    </>
  );
}
