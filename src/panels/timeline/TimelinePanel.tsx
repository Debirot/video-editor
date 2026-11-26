/**
 * Painel inferior: barra fina de ferramentas, cabeçalhos de trilha (DOM) e área das
 * trilhas (canvas, src/timeline/). Os cabeçalhos acompanham a rolagem vertical do canvas.
 */
import { useState } from "react";
import {
  Eye,
  EyeOff,
  Lock,
  LockOpen,
  Magnet,
  Maximize2,
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
import { useView, viewStore } from "@/app/viewStore";
import { cn } from "@/lib/cn";
import { projectStore } from "@/project/store";
import { projectDuration } from "@/project/queries";
import { setTrackFlag } from "@/project/commands/tracks";
import type { Track } from "@/project/types";
import { TimelineCanvas } from "@/timeline/TimelineCanvas";
import { clampScrollX, fitZoom, timeToX, zoomAt, type Viewport } from "@/timeline/viewport";

const TRACK_HEIGHT = "h-11";

/** Zoom pelos botões: ancorado no playhead se ele estiver visível, senão no centro. */
function zoomBy(factor: number) {
  const v = viewStore.getState();
  const vp: Viewport = { pxPerSecond: v.pxPerSecond, scrollX: v.scrollX, width: v.viewportWidth };
  const playheadX = timeToX(v.playhead, vp);
  const anchor = playheadX >= 0 && playheadX <= vp.width ? playheadX : vp.width / 2;
  const z = zoomAt(vp, factor, anchor);
  const content = projectDuration(projectStore.getState().project);
  viewStore.setState({ pxPerSecond: z.pxPerSecond, scrollX: clampScrollX(z.scrollX, content, { ...vp, ...z }) });
}

function zoomToFit() {
  const content = projectDuration(projectStore.getState().project);
  viewStore.setState({ pxPerSecond: fitZoom(content, viewStore.getState().viewportWidth), scrollX: 0 });
}

export function TimelinePanel() {
  const tracks = useProject((s) => s.project.tracks);
  const scrollY = useView((s) => s.scrollY);
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
        <Tip label="Dividir no playhead (em breve)" shortcut="S">
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
          <Tip label="Diminuir zoom" shortcut="Ctrl + roda">
            <Button variant="ghost" size="sm" aria-label="Diminuir zoom" onClick={() => zoomBy(1 / 1.5)}>
              <ZoomOut />
            </Button>
          </Tip>
          <Tip label="Aumentar zoom" shortcut="Ctrl + roda">
            <Button variant="ghost" size="sm" aria-label="Aumentar zoom" onClick={() => zoomBy(1.5)}>
              <ZoomIn />
            </Button>
          </Tip>
          <Tip label="Mostrar tudo">
            <Button variant="ghost" size="sm" aria-label="Mostrar tudo" disabled={empty} onClick={zoomToFit}>
              <Maximize2 />
            </Button>
          </Tip>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="flex w-40 shrink-0 flex-col border-r border-border">
          <div className="h-6 shrink-0 border-b border-border" />
          <div className="min-h-0 flex-1 overflow-hidden">
            <div style={{ transform: `translateY(${-scrollY}px)` }}>
              {video.map((t) => (
                <TrackHeader key={t.id} track={t} />
              ))}
              <div className="h-1 border-b border-border bg-bg-0" />
              {audio.map((t) => (
                <TrackHeader key={t.id} track={t} />
              ))}
            </div>
          </div>
        </div>

        <div className="relative flex min-w-0 flex-1">
          <TimelineCanvas />
          {empty && (
            <div className="pointer-events-none absolute inset-x-0 top-6 bottom-0 flex items-center justify-center">
              <p className="rounded-control border border-border bg-bg-1 px-3 py-1.5 text-body text-text-2">
                Dê dois cliques numa mídia da biblioteca para colocá-la aqui.
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
