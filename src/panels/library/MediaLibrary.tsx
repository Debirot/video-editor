/**
 * Biblioteca de mídia: busca, grade de pôsteres e erros de importação.
 * Padrão de tela "item de biblioteca": pôster 16:9, nome, duração e avisos.
 */
import { useMemo, useState } from "react";
import { AlertTriangle, AudioLines, Film, Image as ImageIcon, Loader2, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tip } from "@/components/ui/tooltip";
import { useProject } from "@/app/useProject";
import { fileName } from "@/app/importMedia";
import { runtimeStore, useRuntime, type MediaRuntime } from "@/app/mediaRuntime";
import { cn } from "@/lib/cn";
import { fpsToNumber } from "@/lib/time";
import type { Media } from "@/project/types";
import { projectStore } from "@/project/store";
import { appendMediaClip } from "@/project/commands/clips";
import { startMediaDrag } from "@/app/mediaDrag";
import { EmptyState } from "./LibraryPanel";

/** Duração curta para o canto do pôster: "0:12", "1:05:30". Só exibição. */
function shortDuration(us: number): string {
  const total = Math.round(us / 1_000_000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

function details(media: Media): string {
  const p = media.probe;
  const parts: string[] = [];
  if (p.width && p.height) {
    const rotated = p.rotation === 90 || p.rotation === 270;
    parts.push(rotated ? `${p.height}×${p.width}` : `${p.width}×${p.height}`);
  }
  if (p.fps) parts.push(`${fpsToNumber(p.fps).toFixed(2).replace(/\.00$/, "")} qps`);
  if (p.videoCodec) parts.push(p.videoCodec.toUpperCase());
  if (p.audioCodec) parts.push(p.audioCodec.toUpperCase());
  return parts.join(" · ");
}

export function MediaLibrary() {
  const media = useProject((s) => s.project.media);
  const errors = useRuntime((s) => s.errors);
  const importing = useRuntime((s) => s.importing);
  const [query, setQuery] = useState("");

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? media.filter((m) => fileName(m.path).toLowerCase().includes(q)) : media;
  }, [media, query]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {media.length > 0 && (
        <label className="mx-3 mb-2 flex h-8 shrink-0 items-center gap-2 rounded-control border border-border bg-bg-2 px-2 focus-within:border-accent">
          <Search className="size-4 text-text-2" />
          <input
            className="min-w-0 flex-1 bg-transparent text-body text-text-1 outline-none placeholder:text-text-2"
            placeholder="Buscar mídia"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
      )}

      {errors.length > 0 && <ImportErrors />}

      {media.length === 0 && importing === 0 ? (
        <EmptyState icon={Film} text="Arraste vídeos, áudios e imagens aqui ou clique em Importar." />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
          {importing > 0 && (
            <p className="mb-2 flex items-center gap-2 text-label text-text-2">
              <Loader2 className="size-3.5 animate-spin" /> Importando {importing} {importing === 1 ? "arquivo" : "arquivos"}…
            </p>
          )}
          {visible.length === 0 && media.length > 0 && (
            <p className="py-6 text-center text-body text-text-2">Nenhuma mídia com “{query}”.</p>
          )}
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(128px,1fr))] gap-2">
            {visible.map((m) => (
              <MediaItem key={m.id} media={m} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function MediaItem({ media }: { media: Media }) {
  const runtime = useRuntime((s) => s.byHash[media.fingerprint.partialHash]) as MediaRuntime | undefined;
  const name = fileName(media.path);
  const KindIcon = media.kind === "audio" ? AudioLines : media.kind === "image" ? ImageIcon : Film;
  const needsProxy = !media.missing && runtime?.decode === "unsupported";
  const vfr = media.probe.variableFrameRate === true;

  return (
    <li
      title={`${name}\n${details(media)}\nArraste para a timeline ou dê dois cliques`}
      className="group flex min-w-0 cursor-grab touch-none flex-col gap-1 select-none"
      onPointerDown={(e) => startMediaDrag(e, media)}
      onDoubleClick={() => {
        const { project, applyCommand } = projectStore.getState();
        applyCommand("Adicionar à timeline", appendMediaClip(media, project.settings.fps));
      }}
    >
      <div
        className={cn(
          "relative flex aspect-video items-center justify-center overflow-hidden rounded-control border bg-bg-0",
          needsProxy || media.missing ? "border-danger" : "border-border group-hover:border-text-2",
        )}
      >
        {runtime?.poster === "ready" && runtime.posterUrl ? (
          <img src={runtime.posterUrl} alt="" draggable={false} className="h-full w-full object-contain" />
        ) : runtime?.poster === "pending" ? (
          <Loader2 className="size-5 animate-spin text-text-2" />
        ) : (
          <KindIcon className="size-6 text-text-2" strokeWidth={1.25} />
        )}

        {media.kind !== "image" && (
          <span className="tabular absolute right-1 bottom-1 rounded-sm bg-bg-0/80 px-1 text-label text-text-1">
            {shortDuration(media.probe.duration)}
          </span>
        )}
        <div className="absolute top-1 left-1 flex gap-1">
          {media.missing && <Badge tone="danger" label="Ausente" hint={`Arquivo não encontrado: ${media.path}`} />}
          {needsProxy && <Badge tone="danger" label="Proxy" hint="O WebCodecs não decodifica este codec aqui. Vai precisar de proxy." />}
          {vfr && <Badge tone="accent" label="VFR" hint="Taxa de quadros variável: pode dessincronizar o áudio. Conversão chega com os proxies." />}
        </div>
      </div>
      <span className="truncate text-label text-text-1">{name}</span>
    </li>
  );
}

function Badge({ tone, label, hint }: { tone: "danger" | "accent"; label: string; hint: string }) {
  return (
    <Tip label={hint}>
      <span
        className={cn(
          "flex items-center gap-0.5 rounded-sm px-1 text-label font-semibold",
          tone === "danger" ? "bg-danger text-text-1" : "bg-accent text-accent-contrast",
        )}
      >
        <AlertTriangle className="size-3" />
        {label}
      </span>
    </Tip>
  );
}

function ImportErrors() {
  const errors = useRuntime((s) => s.errors);
  return (
    <div role="alert" className="mx-3 mb-2 shrink-0 rounded-control border border-danger bg-bg-2 p-2 text-label">
      <div className="mb-1 flex items-center gap-2 font-semibold text-danger">
        <AlertTriangle className="size-3.5" />
        {errors.length === 1 ? "1 arquivo não foi importado" : `${errors.length} arquivos não foram importados`}
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto h-6 px-1"
          aria-label="Fechar aviso"
          onClick={() => runtimeStore.setState({ errors: [] })}
        >
          <X />
        </Button>
      </div>
      <ul className="max-h-24 overflow-y-auto">
        {errors.map((e, i) => (
          <li key={i} className="truncate text-text-2" title={`${e.path}\n${e.error}`}>
            <span className="text-text-1">{fileName(e.path)}</span>: {e.error}
          </li>
        ))}
      </ul>
    </div>
  );
}
