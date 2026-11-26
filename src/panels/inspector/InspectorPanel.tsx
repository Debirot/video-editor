/**
 * Painel direito. Mostra só o que vale para a seleção atual.
 * Sem seleção (único caso até T1.06), mostra as configurações do projeto.
 */
import { MousePointerClick } from "lucide-react";
import { useProject } from "@/app/useProject";
import { fpsToNumber } from "@/lib/time";
import { aspectLabel } from "@/project/queries";
import { InspectorRow, InspectorSection } from "./InspectorSection";

export function InspectorPanel() {
  const settings = useProject((s) => s.project.settings);
  const fps = fpsToNumber(settings.fps);

  return (
    <aside aria-label="Inspetor" className="flex h-full flex-col overflow-y-auto bg-bg-1">
      <header className="flex h-10 shrink-0 items-center px-3">
        <h2 className="text-title font-semibold">Projeto</h2>
      </header>

      <InspectorSection title="Formato">
        <InspectorRow label="Resolução">
          <span className="tabular">
            {settings.width} × {settings.height}
          </span>
        </InspectorRow>
        <InspectorRow label="Proporção">{aspectLabel(settings.width, settings.height)}</InspectorRow>
        <InspectorRow label="Quadros/s">
          <span className="tabular">{Number.isInteger(fps) ? fps : fps.toFixed(3)}</span>
        </InspectorRow>
        <InspectorRow label="Fundo">
          <span className="inline-flex items-center gap-2">
            <span className="size-4 rounded-sm border border-border" style={{ background: settings.background }} />
            <span className="font-mono text-label">{settings.background.toUpperCase()}</span>
          </span>
        </InspectorRow>
      </InspectorSection>

      <InspectorSection title="Áudio">
        <InspectorRow label="Amostragem">
          <span className="tabular">{settings.sampleRate / 1000} kHz</span>
        </InspectorRow>
      </InspectorSection>

      <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-8 text-center">
        <MousePointerClick className="size-6 text-text-2" strokeWidth={1.25} />
        <p className="text-body text-text-2">Selecione um clipe na timeline para editar as propriedades dele.</p>
      </div>
    </aside>
  );
}
