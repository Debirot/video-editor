/**
 * Painel central: área do preview no tamanho do projeto e controles logo abaixo.
 * O preview de verdade (Worker + compositor) entra em T1.07.
 */
import { ChevronLeft, ChevronRight, Clapperboard, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tip } from "@/components/ui/tooltip";
import { useProject } from "@/app/useProject";
import { formatTimecode, frameToUs, usToFrame } from "@/lib/time";
import { useView, viewStore } from "@/app/viewStore";
import { aspectLabel, projectDuration } from "@/project/queries";

export function PreviewPanel() {
  const settings = useProject((s) => s.project.settings);
  const duration = useProject((s) => projectDuration(s.project));
  const empty = duration === 0;
  const playhead = useView((s) => s.playhead);

  const stepFrames = (n: number) => {
    const frame = Math.max(0, usToFrame(viewStore.getState().playhead, settings.fps) + n);
    viewStore.setState({ playhead: frameToUs(frame, settings.fps) });
  };

  return (
    <section aria-label="Preview" className="flex h-full flex-col bg-bg-0">
      {/* Palco: encaixa a proporção do projeto no espaço disponível (container query). */}
      <div className="flex min-h-0 flex-1 items-center justify-center p-4 [container-type:size]">
        <div
          className="flex items-center justify-center"
          style={{
            aspectRatio: `${settings.width} / ${settings.height}`,
            width: `min(100cqw, calc(100cqh * ${settings.width / settings.height}))`,
            background: settings.background,
          }}
        >
          <div className="flex flex-col items-center gap-2 px-6 text-center">
            <Clapperboard className="size-8 text-text-2" strokeWidth={1.25} />
            <p className="text-body text-text-2">
              {empty ? "Adicione clipes à timeline para ver o preview." : "O preview dos clipes chega na próxima etapa."}
            </p>
          </div>
        </div>
      </div>

      <div className="grid h-10 shrink-0 grid-cols-[1fr_auto_1fr] items-center border-t border-border bg-bg-1 px-3">
        <span className="tabular font-mono text-label text-text-1">
          {formatTimecode(playhead, settings.fps)}
          <span className="text-text-2"> / {formatTimecode(duration, settings.fps)}</span>
        </span>
        <div className="flex items-center gap-1">
          <Tip label="Quadro anterior" shortcut="←">
            <Button variant="ghost" size="icon" aria-label="Quadro anterior" disabled={playhead === 0} onClick={() => stepFrames(-1)}>
              <ChevronLeft />
            </Button>
          </Tip>
          <Tip label="Reproduzir (em breve)" shortcut="Espaço">
            <Button variant="ghost" size="icon" aria-label="Reproduzir" disabled>
              <Play />
            </Button>
          </Tip>
          <Tip label="Próximo quadro" shortcut="→">
            <Button variant="ghost" size="icon" aria-label="Próximo quadro" onClick={() => stepFrames(1)}>
              <ChevronRight />
            </Button>
          </Tip>
        </div>
        <span className="justify-self-end text-label text-text-2">
          Completa · {aspectLabel(settings.width, settings.height)}
        </span>
      </div>
    </section>
  );
}
