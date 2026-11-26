/**
 * Barra superior (44 px): nome do projeto, desfazer/refazer, tarefas,
 * configurações e Exportar (o único botão em cor de destaque).
 */
import { useState } from "react";
import { Download, ListChecks, PanelRightClose, PanelRightOpen, Redo2, Settings, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tip } from "@/components/ui/tooltip";
import { useProject } from "@/app/useProject";
import { projectStore } from "@/project/store";
import { renameProject } from "@/project/commands/project";

export function TopBar({ inspectorOpen, onToggleInspector }: { inspectorOpen: boolean; onToggleInspector: () => void }) {
  const past = useProject((s) => s.history.past);
  const future = useProject((s) => s.history.future);
  const pending = useProject((s) => s.history.pending);
  const { undo, redo } = projectStore.getState();
  const undoLabel = past.at(-1)?.label;
  const redoLabel = future[0]?.label;

  return (
    <header className="flex h-[var(--topbar-height)] shrink-0 items-center gap-1 border-b border-border bg-bg-1 px-3">
      <ProjectName />

      <div className="ml-3 flex items-center">
        <Tip label={undoLabel ? `Desfazer: ${undoLabel}` : "Nada para desfazer"} shortcut="Ctrl+Z">
          <Button variant="ghost" size="icon" aria-label="Desfazer" disabled={!undoLabel || !!pending} onClick={undo}>
            <Undo2 />
          </Button>
        </Tip>
        <Tip label={redoLabel ? `Refazer: ${redoLabel}` : "Nada para refazer"} shortcut="Ctrl+Shift+Z">
          <Button variant="ghost" size="icon" aria-label="Refazer" disabled={!redoLabel || !!pending} onClick={redo}>
            <Redo2 />
          </Button>
        </Tip>
      </div>

      <div className="ml-auto flex items-center gap-1">
        <Tip label="Nenhuma tarefa em segundo plano">
          <Button variant="ghost" size="sm" aria-label="Tarefas em segundo plano">
            <ListChecks />
            <span className="tabular text-label">0</span>
          </Button>
        </Tip>
        <Tip label={inspectorOpen ? "Recolher inspetor" : "Mostrar inspetor"}>
          <Button variant="ghost" size="icon" aria-label="Alternar inspetor" onClick={onToggleInspector}>
            {inspectorOpen ? <PanelRightClose /> : <PanelRightOpen />}
          </Button>
        </Tip>
        <Tip label="Configurações (em breve)">
          <Button variant="ghost" size="icon" aria-label="Configurações" disabled>
            <Settings />
          </Button>
        </Tip>
        <Tip label="Exportar (em breve)" shortcut="Ctrl+E">
          <Button variant="accent" className="ml-2" disabled>
            <Download /> Exportar
          </Button>
        </Tip>
      </div>
    </header>
  );
}

/** Nome do projeto editável no lugar. Enter ou sair do campo confirma; Esc desiste. */
function ProjectName() {
  const name = useProject((s) => s.project.name);
  const [draft, setDraft] = useState<string | null>(null);

  const commit = () => {
    if (draft !== null && draft.trim() && draft.trim() !== name) {
      projectStore.getState().applyCommand("Renomear projeto", renameProject(draft));
    }
    setDraft(null);
  };

  return (
    <input
      aria-label="Nome do projeto"
      className="h-8 w-56 truncate rounded-control border border-transparent bg-transparent px-2 text-title font-semibold text-text-1 outline-none hover:border-border focus:border-accent focus:bg-bg-2"
      value={draft ?? name}
      spellCheck={false}
      onFocus={(e) => {
        setDraft(name);
        e.currentTarget.select();
      }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          setDraft(null);
          // Sai do campo sem confirmar: o onBlur vê draft === null.
          requestAnimationFrame(() => (e.target as HTMLInputElement).blur());
        }
      }}
    />
  );
}
