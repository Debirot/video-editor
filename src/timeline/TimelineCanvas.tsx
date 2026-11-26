/**
 * Hospeda o canvas da timeline. O React só monta o elemento; desenho e
 * interação são imperativos: qualquer mudança no projeto, na tela (viewStore),
 * na seleção ou nos pôsteres agenda um único redesenho no próximo requestAnimationFrame.
 * Os gestos do mouse ficam em gestures.ts.
 */
import { useEffect, useRef } from "react";
import { projectStore } from "@/project/store";
import { projectDuration } from "@/project/queries";
import { insertMediaAt, mediaClipDuration } from "@/project/commands/clips";
import type { Media, Project } from "@/project/types";
import { viewStore } from "@/app/viewStore";
import { runtimeStore } from "@/app/mediaRuntime";
import { selectionStore, setSelection } from "@/app/selectionStore";
import { setMediaDropTarget } from "@/app/mediaDrag";
import { snapToFrame } from "@/lib/time";
import { drawTimeline, readPalette } from "./draw";
import { attachGestures, type Overlay } from "./gestures";
import { trackAtY } from "./hitTest";
import { snapBlock, snapPoints, snapThreshold } from "./snap";
import { clamp, clampScrollX, RULER_HEIGHT, trackLayout, xToTime, zoomAt, type Viewport } from "./viewport";

function viewport(): Viewport {
  const v = viewStore.getState();
  return { pxPerSecond: v.pxPerSecond, scrollX: v.scrollX, width: v.viewportWidth };
}

function maxScrollY(height: number): number {
  const layout = trackLayout(projectStore.getState().project.tracks);
  return Math.max(0, layout.height - (height - RULER_HEIGHT));
}

/** Onde uma mídia solta em (x, y) do canvas cairia: início (com encaixe) e trilhas de vídeo/áudio. */
function dropPlan(project: Project, media: Media, x: number, y: number) {
  const fps = project.settings.fps;
  const duration = mediaClipDuration(media, fps);
  const hovered = trackAtY(y, viewStore.getState().scrollY, trackLayout(project.tracks));
  let start = Math.max(0, xToTime(x, viewport()));
  if (viewStore.getState().snap) {
    const points = snapPoints(project, new Set(), viewStore.getState().playhead);
    start += snapBlock(start, start + duration, points, snapThreshold(viewStore.getState().pxPerSecond));
  }
  start = Math.max(0, snapToFrame(start, fps));
  const pick = (kind: "video" | "audio") => {
    const t = project.tracks.find((tr) => tr.id === hovered);
    if (t && t.kind === kind && !t.locked) return t;
    return project.tracks.find((tr) => tr.kind === kind && !tr.locked);
  };
  const wantsVideo = media.kind !== "audio";
  const wantsAudio = media.kind === "audio" || (media.kind === "video" && !!media.probe.audioCodec);
  const tracks = [wantsVideo ? pick("video") : undefined, wantsAudio ? pick("audio") : undefined].filter((t) => !!t);
  return { start, duration, hovered, tracks };
}

export function TimelineCanvas() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const wrap = wrapRef.current!;
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    const palette = readPalette();
    const images = new Map<string, HTMLImageElement>();
    const overlay: Overlay = { marquee: null, ghosts: [] };
    let size = { width: 0, height: 0, dpr: 1 };
    let frame = 0;

    const posterFor = (media: Media): CanvasImageSource | null => {
      const url = runtimeStore.getState().byHash[media.fingerprint.partialHash]?.posterUrl;
      if (!url) return null;
      let img = images.get(url);
      if (!img) {
        img = new Image();
        img.onload = schedule;
        img.src = url;
        images.set(url, img);
      }
      return img.complete && img.naturalWidth > 0 ? img : null;
    };

    function draw() {
      frame = 0;
      if (size.width === 0 || size.height === 0) return;
      const { project } = projectStore.getState();
      const view = viewStore.getState();
      drawTimeline({
        ctx,
        ...size,
        vp: viewport(),
        scrollY: clamp(view.scrollY, 0, maxScrollY(size.height)),
        fps: project.settings.fps,
        tracks: project.tracks,
        layout: trackLayout(project.tracks),
        playhead: view.playhead,
        selected: new Set(selectionStore.getState().clipIds),
        media: new Map(project.media.map((m) => [m.id, m])),
        posterFor,
        palette,
        overlay,
      });
    }

    function schedule() {
      if (!frame) frame = requestAnimationFrame(draw);
    }

    const resize = new ResizeObserver(([entry]) => {
      const { width, height } = entry!.contentRect;
      const dpr = window.devicePixelRatio || 1;
      size = { width, height, dpr };
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      viewStore.setState({ viewportWidth: width });
      schedule();
    });
    resize.observe(wrap);

    const detachGestures = attachGestures({ canvas, viewport, overlay, redraw: schedule });

    // Roda: Ctrl = zoom no cursor; Shift ou touchpad lateral = horizontal;
    // vertical só quando as trilhas não cabem, senão também rola na horizontal.
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const content = projectDuration(projectStore.getState().project);
      const vp = viewport();
      if (e.ctrlKey || e.metaKey) {
        const z = zoomAt(vp, Math.exp(-e.deltaY * 0.002), e.offsetX);
        viewStore.setState({ pxPerSecond: z.pxPerSecond, scrollX: clampScrollX(z.scrollX, content, { ...vp, ...z }) });
        return;
      }
      const overflowY = maxScrollY(size.height) > 0;
      if (e.shiftKey || e.deltaX !== 0 || !overflowY) {
        const dx = e.deltaX !== 0 ? e.deltaX : e.deltaY;
        viewStore.setState({ scrollX: clampScrollX(vp.scrollX + dx, content, vp) });
      } else {
        const v = viewStore.getState();
        viewStore.setState({ scrollY: clamp(v.scrollY + e.deltaY, 0, maxScrollY(size.height)) });
      }
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });

    // Mídia arrastada da biblioteca.
    const local = (clientX: number, clientY: number) => {
      const r = canvas.getBoundingClientRect();
      const x = clientX - r.left;
      const y = clientY - r.top;
      return x >= 0 && y >= RULER_HEIGHT && x <= r.width && y <= r.height ? { x, y } : null;
    };
    setMediaDropTarget({
      hover: (cx, cy, media) => {
        const p = local(cx, cy);
        overlay.ghosts = [];
        if (p) {
          const plan = dropPlan(projectStore.getState().project, media, p.x, p.y);
          overlay.ghosts = plan.tracks.map((t) => ({ trackId: t.id, start: plan.start, duration: plan.duration }));
        }
        schedule();
        return overlay.ghosts.length > 0;
      },
      drop: (cx, cy, media) => {
        const p = local(cx, cy);
        if (!p) return false;
        const store = projectStore.getState();
        const plan = dropPlan(store.project, media, p.x, p.y);
        if (plan.tracks.length === 0) return false;
        const before = new Set(store.project.tracks.flatMap((t) => t.clips.map((c) => c.id)));
        store.applyCommand("Inserir mídia", insertMediaAt(media, store.project.settings.fps, plan.start, plan.hovered));
        const added = projectStore.getState().project.tracks.flatMap((t) => t.clips.map((c) => c.id)).filter((id) => !before.has(id));
        setSelection(added);
        return true;
      },
      leave: () => {
        overlay.ghosts = [];
        schedule();
      },
    });

    const unsubs = [
      projectStore.subscribe(schedule),
      viewStore.subscribe(schedule),
      runtimeStore.subscribe(schedule),
      selectionStore.subscribe(schedule),
    ];

    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      detachGestures();
      setMediaDropTarget(null);
      unsubs.forEach((u) => u());
      canvas.removeEventListener("wheel", onWheel);
    };
  }, []);

  return (
    <div ref={wrapRef} className="relative min-w-0 flex-1 overflow-hidden">
      <canvas ref={canvasRef} className="absolute inset-0 touch-none" aria-label="Trilhas da timeline" />
    </div>
  );
}
