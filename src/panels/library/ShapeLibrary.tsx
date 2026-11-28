/**
 * Biblioteca de formas: clicar põe a forma no playhead, na trilha de vídeo mais alta
 * livre (ou numa trilha nova acima), e já a seleciona para editar no inspetor e no preview.
 */
import { Circle, Minus, Square, type LucideIcon } from "lucide-react";
import { newId } from "@/lib/ids";
import { projectStore } from "@/project/store";
import { addShapeClip, SHAPE_NAMES } from "@/project/commands/shapes";
import type { ShapeType } from "@/project/types";
import { viewStore } from "@/app/viewStore";
import { selectClip } from "@/app/selectionStore";

const ICONS: Record<ShapeType, LucideIcon> = { rect: Square, ellipse: Circle, line: Minus };

export function addShapeAtPlayhead(type: ShapeType): void {
  const store = projectStore.getState();
  const id = newId("c");
  store.applyCommand(`Adicionar ${SHAPE_NAMES[type].toLowerCase()}`, addShapeClip(type, viewStore.getState().playhead, store.project.settings.fps, id));
  selectClip(id, false);
}

export function ShapeLibrary() {
  return (
    <div className="flex flex-col gap-3 px-3 pb-3">
      <ul className="grid grid-cols-3 gap-2">
        {(Object.keys(SHAPE_NAMES) as ShapeType[]).map((type) => {
          const Icon = ICONS[type];
          return (
            <li key={type}>
              <button
                type="button"
                onClick={() => addShapeAtPlayhead(type)}
                className="flex w-full flex-col items-center gap-1.5 rounded-control border border-border bg-bg-2 px-2 py-3 text-label text-text-2 transition-colors duration-[var(--duration-fast)] hover:border-text-2 hover:text-text-1"
              >
                <Icon className="size-6" strokeWidth={1.5} />
                {SHAPE_NAMES[type]}
              </button>
            </li>
          );
        })}
      </ul>
      <p className="text-label text-text-2">Clique para pôr a forma no playhead. Cor, tamanho e borda ficam no inspetor.</p>
    </div>
  );
}
