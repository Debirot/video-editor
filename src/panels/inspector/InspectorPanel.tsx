/**
 * Painel direito. Mostra só o que vale para a seleção atual:
 * nada selecionado → projeto; um clipe (com o ligado) → ClipInspector; vários → resumo.
 */
import { Layers, MousePointerClick } from "lucide-react";
import { useProject } from "@/app/useProject";
import { useSelection } from "@/app/selectionStore";
import { fpsToNumber } from "@/lib/time";
import { aspectLabel } from "@/project/queries";
import type { Clip, Project, Track } from "@/project/types";
import { ClipInspector } from "./ClipInspector";
import { InspectorRow, InspectorSection } from "./InspectorSection";

/** Clipes selecionados agrupados por linkGroup (vídeo + áudio do mesmo arquivo = 1 grupo). */
function selectedGroups(project: Project, ids: string[]): { clip: Clip; track: Track }[][] {
  const wanted = new Set(ids);
  const groups = new Map<string, { clip: Clip; track: Track }[]>();
  for (const track of project.tracks) {
    for (const clip of track.clips) {
      if (!wanted.has(clip.id)) continue;
      const key = clip.linkGroup ?? clip.id;
      groups.set(key, [...(groups.get(key) ?? []), { clip, track }]);
    }
  }
  return [...groups.values()];
}

export function InspectorPanel() {
  const project = useProject((s) => s.project);
  const ids = useSelection((s) => s.clipIds);
  const groups = selectedGroups(project, ids);

  return (
    <aside aria-label="Inspetor" className="flex h-full flex-col overflow-y-auto bg-bg-1">
      {groups.length === 1 ? (
        <ClipInspector project={project} clips={groups[0]!} />
      ) : groups.length > 1 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-8 text-center">
          <Layers className="size-6 text-text-2" strokeWidth={1.25} />
          <p className="text-body text-text-1">{groups.length} clipes selecionados</p>
          <p className="text-label text-text-2">Selecione um só para editar as propriedades dele.</p>
        </div>
      ) : (
        <ProjectInspector />
      )}
    </aside>
  );
}

function ProjectInspector() {
  const settings = useProject((s) => s.project.settings);
  const fps = fpsToNumber(settings.fps);

  return (
    <>
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
    </>
  );
}
