/**
 * Hospeda o canvas da timeline. O React só monta o elemento; desenho e
 * interação são imperativos: qualquer mudança no projeto, na tela (viewStore)
 * ou nos pôsteres agenda um único redesenho no próximo requestAnimationFrame.
 */
import { useEffect, useRef } from "react";
import { projectStore } from "@/project/store";
import { projectDuration } from "@/project/queries";
import type { Media } from "@/project/types";
import { viewStore } from "@/app/viewStore";
import { runtimeStore } from "@/app/mediaRuntime";
import { snapToFrame } from "@/lib/time";
import { drawTimeline, readPalette } from "./draw";
import { clamp, clampScrollX, RULER_HEIGHT, trackLayout, xToTime, zoomAt, type Viewport } from "./viewport";

function viewport(): Viewport {
  const v = viewStore.getState();
  return { pxPerSecond: v.pxPerSecond, scrollX: v.scrollX, width: v.viewportWidth };
}

function maxScrollY(height: number): number {
  const layout = trackLayout(projectStore.getState().project.tracks);
  return Math.max(0, layout.height - (height - RULER_HEIGHT));
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
      const layout = trackLayout(project.tracks);
      drawTimeline({
        ctx,
        ...size,
        vp: viewport(),
        scrollY: clamp(view.scrollY, 0, maxScrollY(size.height)),
        fps: project.settings.fps,
        tracks: project.tracks,
        layout,
        playhead: view.playhead,
        media: new Map(project.media.map((m) => [m.id, m])),
        posterFor,
        palette,
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

    // Playhead: clicar ou arrastar na régua.
    let scrubbing = false;
    const setPlayheadAt = (x: number) => {
      const fps = projectStore.getState().project.settings.fps;
      viewStore.setState({ playhead: snapToFrame(xToTime(x, viewport()), fps) });
    };
    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0 || e.offsetY > RULER_HEIGHT) return;
      scrubbing = true;
      canvas.setPointerCapture(e.pointerId);
      setPlayheadAt(e.offsetX);
    };
    const onPointerMove = (e: PointerEvent) => {
      if (scrubbing) setPlayheadAt(clamp(e.offsetX, 0, size.width));
    };
    const onPointerUp = (e: PointerEvent) => {
      scrubbing = false;
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    };

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

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    const unsubs = [projectStore.subscribe(schedule), viewStore.subscribe(schedule), runtimeStore.subscribe(schedule)];

    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      unsubs.forEach((u) => u());
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerUp);
      canvas.removeEventListener("wheel", onWheel);
    };
  }, []);

  return (
    <div ref={wrapRef} className="relative min-w-0 flex-1 overflow-hidden">
      <canvas ref={canvasRef} className="absolute inset-0" aria-label="Trilhas da timeline" />
    </div>
  );
}
