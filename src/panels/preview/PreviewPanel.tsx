/**
 * Painel central: preview composto pelo Worker (canvas transferido) e controles.
 * O canvas tem a resolução do projeto × qualidade; o CSS encaixa na área disponível.
 */
import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Clapperboard, Pause, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tip } from "@/components/ui/tooltip";
import { useProject } from "@/app/useProject";
import { formatTimecode } from "@/lib/time";
import { aspectLabel, projectDuration } from "@/project/queries";
import { useView, viewStore } from "@/app/viewStore";
import { runAction } from "@/app/editActions";
import { attachPreviewCanvas, onEngineError, togglePlay } from "@/app/engine";
import type { PreviewQuality } from "@/engine/messages";

const QUALITIES: { scale: PreviewQuality; label: string }[] = [
  { scale: 1, label: "Completa" },
  { scale: 0.5, label: "1/2" },
  { scale: 0.25, label: "1/4" },
];

export function PreviewPanel() {
  const settings = useProject((s) => s.project.settings);
  const duration = useProject((s) => projectDuration(s.project));
  const empty = duration === 0;
  const playhead = useView((s) => s.playhead);
  const playing = useView((s) => s.playing);
  const rate = useView((s) => s.rate);
  const quality = useView((s) => s.quality);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (canvasRef.current) attachPreviewCanvas(canvasRef.current);
    return onEngineError((message) => setError(message));
  }, []);

  const qualityLabel = QUALITIES.find((q) => q.scale === quality)?.label ?? "Completa";
  const nextQuality = () => {
    const i = QUALITIES.findIndex((q) => q.scale === quality);
    viewStore.setState({ quality: QUALITIES[(i + 1) % QUALITIES.length]!.scale });
  };

  return (
    <section aria-label="Preview" className="flex h-full flex-col bg-bg-0">
      {/* Palco: encaixa a proporção do projeto no espaço disponível (container query). */}
      <div className="flex min-h-0 flex-1 items-center justify-center p-4 [container-type:size]">
        <div
          className="relative flex items-center justify-center"
          style={{
            aspectRatio: `${settings.width} / ${settings.height}`,
            width: `min(100cqw, calc(100cqh * ${settings.width / settings.height}))`,
            background: settings.background,
          }}
        >
          <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" aria-label="Imagem do preview" />
          {empty && (
            <div className="relative flex flex-col items-center gap-2 px-6 text-center">
              <Clapperboard className="size-8 text-text-2" strokeWidth={1.25} />
              <p className="text-body text-text-2">Adicione clipes à timeline para ver o preview.</p>
            </div>
          )}
          {error && (
            <button
              type="button"
              onClick={() => setError(null)}
              className="absolute top-2 left-2 max-w-[80%] truncate rounded-control border border-danger bg-bg-1 px-2 py-1 text-left text-label text-danger"
              title={error}
            >
              Preview: {error}
            </button>
          )}
          {import.meta.env.DEV && <DevStats />}
        </div>
      </div>

      <div className="grid h-10 shrink-0 grid-cols-[1fr_auto_1fr] items-center border-t border-border bg-bg-1 px-3">
        <span className="tabular font-mono text-label text-text-1">
          {formatTimecode(playhead, settings.fps)}
          <span className="text-text-2"> / {formatTimecode(duration, settings.fps)}</span>
        </span>
        <div className="flex items-center gap-1">
          <Tip label="Quadro anterior" shortcut="←">
            <Button variant="ghost" size="icon" aria-label="Quadro anterior" disabled={playhead === 0} onClick={() => runAction("frameBack")}>
              <ChevronLeft />
            </Button>
          </Tip>
          <Tip label={playing ? "Pausar" : "Reproduzir"} shortcut="Espaço">
            <Button variant="ghost" size="icon" aria-label={playing ? "Pausar" : "Reproduzir"} disabled={empty} onClick={togglePlay}>
              {playing ? <Pause /> : <Play />}
            </Button>
          </Tip>
          <Tip label="Próximo quadro" shortcut="→">
            <Button variant="ghost" size="icon" aria-label="Próximo quadro" onClick={() => runAction("frameForward")}>
              <ChevronRight />
            </Button>
          </Tip>
          {playing && rate !== 1 && <span className="tabular w-8 text-label text-accent">{rate}×</span>}
        </div>
        <div className="flex items-center justify-self-end gap-2 text-label text-text-2">
          <Tip label="Qualidade do preview (só a tela; a exportação usa sempre a completa)">
            <Button variant="ghost" size="sm" onClick={nextQuality} aria-label="Qualidade do preview">
              {qualityLabel}
            </Button>
          </Tip>
          <span>· {aspectLabel(settings.width, settings.height)}</span>
        </div>
      </div>
    </section>
  );
}

/** Contadores de diagnóstico (só em desenvolvimento): quadros abertos e descartados. */
function DevStats() {
  const openFrames = useView((s) => s.openFrames);
  const dropped = useView((s) => s.droppedFrames);
  return (
    <div className="pointer-events-none absolute right-1 bottom-1 rounded-sm bg-bg-0/70 px-1.5 py-0.5 font-mono text-label text-text-2">
      <span className="tabular">quadros {openFrames} · perdidos {dropped}</span>
    </div>
  );
}
