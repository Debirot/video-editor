/**
 * Alças de transformação sobre o preview, para o clipe selecionado (vídeo, imagem ou forma) que aparece
 * no playhead: arrastar dentro move (encaixa no centro), cantos mudam a escala, a alça
 * de cima gira (Shift = passos de 15°). Clicar numa camada a seleciona.
 * Cada arrasto é uma transação (um passo de desfazer); Esc cancela.
 * Usa a mesma matemática do compositor (engine/transform.ts), então a moldura cai
 * exatamente sobre a imagem.
 */
import { useEffect, useRef, useState } from "react";
import { useProject } from "@/app/useProject";
import { useView } from "@/app/viewStore";
import { selectClip, useSelection } from "@/app/selectionStore";
import { projectStore } from "@/project/store";
import { clipAt } from "@/project/queries";
import { setClipTransform } from "@/project/commands/clipProps";
import type { Clip, Project, Track } from "@/project/types";
import { containsPoint, placeLayer, visibleCorners, type Placement, type Size } from "@/engine/transform";
import { shapeSize } from "@/engine/shapes";

const HANDLE = 9;
const ROTATE_OFFSET = 26;
const CENTER_SNAP_PX = 6;

interface Layer {
  clip: Clip;
  track: Track;
  placement: Placement;
}

/** Camadas visíveis no tempo t, de cima para baixo (a primeira é a que recebe o clique). */
function layersAt(project: Project, t: number, stage: Size): Layer[] {
  const out: Layer[] = [];
  for (const track of project.tracks) {
    if (track.kind !== "video" || track.hidden) continue;
    const clip = clipAt(track, t);
    if (!clip || !clip.enabled) continue;
    if (clip.kind === "shape") {
      if (clip.shape) out.push({ clip, track, placement: placeLayer(shapeSize(clip.shape), stage, project.settings, clip.transform, clip.crop) });
      continue;
    }
    const media = clip.mediaId ? project.media.find((m) => m.id === clip.mediaId) : undefined;
    if (!media || media.missing || media.kind === "audio" || !media.probe.width || !media.probe.height) continue;
    // Vídeo de celular (matriz) e foto de celular (EXIF): o giro do arquivo vem do probe.
    const src = { width: media.probe.width, height: media.probe.height, rotation: media.probe.rotation ?? 0 };
    out.push({ clip, track, placement: placeLayer(src, stage, project.settings, clip.transform, clip.crop) });
  }
  return out.reverse();
}

type Drag =
  | { kind: "move"; x0: number; y0: number; tx: number; ty: number }
  | { kind: "scale"; cx: number; cy: number; d0: number; s0: number }
  | { kind: "rotate"; cx: number; cy: number; a0: number; r0: number };

export function TransformHandles() {
  const ref = useRef<SVGSVGElement>(null);
  const [stage, setStage] = useState<Size>({ width: 0, height: 0 });
  const project = useProject((s) => s.project);
  const playhead = useView((s) => s.playhead);
  const playing = useView((s) => s.playing);
  const selected = useSelection((s) => s.clipIds);
  const drag = useRef<Drag | null>(null);

  useEffect(() => {
    const el = ref.current!;
    const ro = new ResizeObserver(([e]) => setStage({ width: e!.contentRect.width, height: e!.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Esc durante o arrasto desfaz o que o arrasto fez.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || !drag.current) return;
      e.preventDefault();
      e.stopPropagation();
      drag.current = null;
      projectStore.getState().cancelTransaction();
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, []);

  const layers = stage.width > 0 ? layersAt(project, playhead, stage) : [];
  const active = playing ? undefined : layers.find((l) => selected.includes(l.clip.id) && !l.track.locked);
  const pxToProject = stage.width > 0 ? project.settings.width / stage.width : 1;

  const local = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top] as const;
  };

  const begin = (e: React.PointerEvent, d: Drag, label: string) => {
    e.stopPropagation();
    ref.current!.setPointerCapture(e.pointerId);
    drag.current = d;
    projectStore.getState().beginTransaction(label);
  };

  const onBackgroundDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || playing) return;
    const [x, y] = local(e);
    const hit = layers.find((l) => containsPoint(l.placement, x, y));
    if (!hit) {
      selectClip(null, e.ctrlKey || e.metaKey);
      return;
    }
    if (!selected.includes(hit.clip.id)) selectClip(hit.clip.id, e.ctrlKey || e.metaKey);
    if (hit.track.locked) return;
    begin(e, { kind: "move", x0: x, y0: y, tx: hit.clip.transform.x, ty: hit.clip.transform.y }, "Mover na tela");
  };

  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    const target = layers.find((l) => selected.includes(l.clip.id) && !l.track.locked);
    if (!d || !target) return;
    const [x, y] = local(e);
    let patch: Parameters<typeof setClipTransform>[1];
    if (d.kind === "move") {
      let dx = x - d.x0;
      let dy = y - d.y0;
      if (e.shiftKey) {
        if (Math.abs(dx) > Math.abs(dy)) dy = 0;
        else dx = 0;
      }
      let nx = d.tx + dx * pxToProject;
      let ny = d.ty + dy * pxToProject;
      // Encaixa no centro da tela.
      if (Math.abs(nx) < CENTER_SNAP_PX * pxToProject) nx = 0;
      if (Math.abs(ny) < CENTER_SNAP_PX * pxToProject) ny = 0;
      patch = { x: Math.round(nx), y: Math.round(ny) };
    } else if (d.kind === "scale") {
      patch = { scale: (d.s0 * Math.hypot(x - d.cx, y - d.cy)) / d.d0 };
    } else {
      let r = d.r0 + ((Math.atan2(y - d.cy, x - d.cx) - d.a0) * 180) / Math.PI;
      if (e.shiftKey) r = Math.round(r / 15) * 15;
      patch = { rotation: Math.round(r * 10) / 10 };
    }
    const store = projectStore.getState();
    store.cancelTransaction();
    store.beginTransaction(d.kind === "move" ? "Mover na tela" : d.kind === "scale" ? "Escala" : "Rotação");
    store.applyCommand("", setClipTransform([target.clip.id], patch));
  };

  const onUp = (e: React.PointerEvent) => {
    if (ref.current?.hasPointerCapture(e.pointerId)) ref.current.releasePointerCapture(e.pointerId);
    if (!drag.current) return;
    drag.current = null;
    projectStore.getState().commitTransaction();
  };

  const p = active?.placement;
  const corners = p ? visibleCorners(p) : [];
  // Alça de rotação: acima do meio da borda de cima, na direção "para cima" da imagem.
  const top = corners.length ? [(corners[0]![0] + corners[1]![0]) / 2, (corners[0]![1] + corners[1]![1]) / 2] : [0, 0];
  const up = p ? [Math.sin(p.angle), -Math.cos(p.angle)] : [0, -1];
  const rot = [top[0]! + up[0]! * ROTATE_OFFSET, top[1]! + up[1]! * ROTATE_OFFSET];

  return (
    <svg
      ref={ref}
      className="absolute inset-0 h-full w-full touch-none"
      aria-label="Alças de transformação"
      onPointerDown={onBackgroundDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
    >
      {p && active && (
        <g>
          <polygon
            points={corners.map(([x, y]) => `${x},${y}`).join(" ")}
            className="cursor-move fill-transparent stroke-accent"
            strokeWidth={1.5}
          />
          <line x1={top[0]} y1={top[1]} x2={rot[0]} y2={rot[1]} className="stroke-accent" strokeWidth={1.5} />
          <circle
            cx={rot[0]}
            cy={rot[1]}
            r={6}
            className="cursor-grab fill-bg-1 stroke-accent"
            strokeWidth={1.5}
            aria-label="Girar"
            onPointerDown={(e) => {
              if (e.button !== 0) return;
              const [x, y] = local(e);
              begin(e, { kind: "rotate", cx: p.cx, cy: p.cy, a0: Math.atan2(y - p.cy, x - p.cx), r0: active.clip.transform.rotation }, "Rotação");
            }}
          />
          {corners.map(([x, y], i) => (
            <rect
              key={i}
              x={x - HANDLE / 2}
              y={y - HANDLE / 2}
              width={HANDLE}
              height={HANDLE}
              className="fill-bg-1 stroke-accent"
              strokeWidth={1.5}
              style={{ cursor: i % 2 === 0 ? "nwse-resize" : "nesw-resize" }}
              aria-label="Escala"
              onPointerDown={(e) => {
                if (e.button !== 0) return;
                const [px, py] = local(e);
                begin(e, { kind: "scale", cx: p.cx, cy: p.cy, d0: Math.max(1, Math.hypot(px - p.cx, py - p.cy)), s0: active.clip.transform.scale }, "Escala");
              }}
            />
          ))}
        </g>
      )}
    </svg>
  );
}
