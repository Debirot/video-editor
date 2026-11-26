/**
 * Painel inferior: barra fina de ferramentas, cabeçalhos de trilha e área das trilhas.
 * O desenho em canvas (régua, clipes, playhead, zoom) entra em T1.05, em src/timeline/.
 */
import { useState } from "react";
import {
  Eye,
  EyeOff,
  Lock,
  LockOpen,
  Magnet,
  MousePointer2,
  Scissors,
  Volume2,
  VolumeX,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tip } from "@/components/ui/tooltip";
import { useProject } from "@/app/useProject";
import { cn } from "@/lib/cn";
import { projectStore } from "@/project/store";
import { setTrackFlag } from "@/project/commands/tracks";
import type { Track } from "@/project/types";

const TRACK_HEIGHT = "h-11";

export function TimelinePanel() {
  const tracks = useProject((s) => s.project.tracks);
  const [snap, setSnap] = useState(true);

  // Vídeo: índice maior fica por cima na composição, então aparece no topo.
  const video = tracks.filter((t) => t.kind === "video").reverse();
  const audio = tracks.filter((t) => t.kind === "audio");
  const empty = tracks.every((t) => t.clips.length === 0);

  return (
    <section aria-label="Timeline" className="flex h-full flex-col bg-bg-1">
      <div className="flex h-8 shrink-0 items-center gap-1 border-b border-border px-2">
        <Tip label="Selecionar" shortcut="V">
          <Button variant="ghost" size="sm" aria-label="Selecionar" aria-pressed className="text-text-1">
            <MousePointer2 />
          </Button>
        </Tip>
        <Tip label="Dividir no playhead" shortcut="S">
          <Button variant="ghost" size="sm" aria-label="Dividir no playhead" disabled>
            <Scissors />
          </Button>
        </Tip>
        <div className="ml-auto flex items-center gap-1">
          <Tip label={snap ? "Encaixe ligado" : "Encaixe desligado"} shortcut="N">
            <Button
              variant="ghost"
              size="sm"
              aria-label="Encaixe"
              aria-pressed={snap}
              onClick={() => setSnap((s) => !s)}
              className={cn(snap && "text-accent hover:text-accent")}
            >
              <Magnet />
            </Button>
          </Tip>
          <Tip label="Diminuir zoom" shortcut="−">
            <Button variant="ghost" size="sm" aria-label="Diminuir zoom" disabled={empty}>
              <ZoomOut />
            </Button>
          </Tip>
          <Tip label="Aumentar zoom" shortcut="+">
            <Button variant="ghost" size="sm" aria-label="Aumentar zoom" disabled={empty}>
              <ZoomIn />
            </Button>
          </Tip>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 overflow-y-auto">
        <div className="w-40 shrink-0 border-r border-border">
          <div className="h-6 border-b border-border" />
          {video.map((t) => (
            <TrackHeader key={t.id} track={t} />
          ))}
          <div className="h-1 border-b border-border bg-bg-0" />
          {audio.map((t) => (
            <TrackHeader key={t.id} track={t} />
          ))}
        </div>

        <div className="relative min-w-0 flex-1 bg-bg-0">
          <div className="h-6 border-b border-border bg-bg-1" aria-label="Régua" />
          {video.map((t) => (
            <div key={t.id} className={cn(TRACK_HEIGHT, "border-b border-border")} />
          ))}
          <div className="h-1 border-b border-border bg-bg-1" />
          {audio.map((t) => (
            <div key={t.id} className={cn(TRACK_HEIGHT, "border-b border-border")} />
          ))}
          {empty && (
            <div className="pointer-events-none absolute inset-x-0 top-6 bottom-0 flex items-center justify-center">
              <p className="rounded-control border border-border bg-bg-1 px-3 py-1.5 text-body text-text-2">
                Arraste clipes da biblioteca para cá.
              </p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function TrackHeader({ track }: { track: Track }) {
  const toggle = (flag: "hidden" | "muted" | "locked", label: string) =>
    projectStore.getState().applyCommand(label, setTrackFlag(track.id, flag, !track[flag]));

  const isVideo = track.kind === "video";
  const visibility = isVideo
    ? { flag: "hidden" as const, on: track.hidden, label: track.hidden ? "Mostrar trilha" : "Ocultar trilha", icon: track.hidden ? EyeOff : Eye }
    : { flag: "muted" as const, on: track.muted, label: track.muted ? "Ativar som" : "Silenciar trilha", icon: track.muted ? VolumeX : Volume2 };
  const VisIcon = visibility.icon;

  return (
    <div className={cn(TRACK_HEIGHT, "flex items-center gap-1 border-b border-border bg-bg-2 pl-3 pr-1")}>
      <span
        className={cn("mr-auto truncate text-label font-semibold", isVideo ? "text-clip-video" : "text-clip-audio")}
        title={track.name}
      >
        {track.name}
      </span>
      <Tip label={visibility.label}>
        <Button
          variant="ghost"
          size="sm"
          aria-label={visibility.label}
          aria-pressed={visibility.on}
          className={cn("px-1.5", visibility.on && "text-danger hover:text-danger")}
          onClick={() => toggle(visibility.flag, visibility.label)}
        >
          <VisIcon />
        </Button>
      </Tip>
      <Tip label={track.locked ? "Destravar trilha" : "Travar trilha"}>
        <Button
          variant="ghost"
          size="sm"
          aria-label={track.locked ? "Destravar trilha" : "Travar trilha"}
          aria-pressed={track.locked}
          className={cn("px-1.5", track.locked && "text-accent hover:text-accent")}
          onClick={() => toggle("locked", track.locked ? "Destravar trilha" : "Travar trilha")}
        >
          {track.locked ? <Lock /> : <LockOpen />}
        </Button>
      </Tip>
    </div>
  );
}
