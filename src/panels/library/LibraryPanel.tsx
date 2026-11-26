/**
 * Painel esquerdo: coluna de ícones + uma biblioteca por vez.
 * Clicar na aba ativa recolhe o painel; clicar em qualquer aba com o painel
 * recolhido abre de novo.
 */
import { AudioLines, Blend, Film, Import, Sparkles, Type, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tip } from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";

export type LibraryTab = "media" | "audio" | "text" | "transitions" | "effects";

interface TabInfo {
  id: LibraryTab;
  label: string;
  icon: LucideIcon;
  empty: string;
}

export const LIBRARY_TABS: TabInfo[] = [
  { id: "media", label: "Mídia", icon: Film, empty: "Arraste vídeos, áudios e imagens aqui ou clique em Importar." },
  { id: "audio", label: "Áudio", icon: AudioLines, empty: "Músicas e efeitos sonoros importados aparecem aqui." },
  { id: "text", label: "Texto", icon: Type, empty: "Arraste um modelo de título para a timeline." },
  { id: "transitions", label: "Transições", icon: Blend, empty: "Arraste uma transição para o corte entre dois clipes." },
  { id: "effects", label: "Efeitos", icon: Sparkles, empty: "Arraste um efeito para um clipe da timeline." },
];

/** Coluna fixa de ícones à esquerda da biblioteca. */
export function LibraryRail({
  active,
  open,
  onSelect,
}: {
  active: LibraryTab;
  open: boolean;
  onSelect: (tab: LibraryTab) => void;
}) {
  return (
    <nav aria-label="Bibliotecas" className="flex w-11 shrink-0 flex-col items-center gap-1 border-r border-border bg-bg-1 py-2">
      {LIBRARY_TABS.map(({ id, label, icon: Icon }) => {
        const selected = open && id === active;
        return (
          <Tip key={id} label={label} side="right">
            <button
              type="button"
              aria-label={label}
              aria-pressed={selected}
              onClick={() => onSelect(id)}
              className={cn(
                "relative flex size-9 items-center justify-center rounded-control transition-colors duration-[var(--duration-fast)] [&_svg]:size-4",
                selected ? "bg-bg-2 text-text-1" : "text-text-2 hover:bg-bg-2 hover:text-text-1",
              )}
            >
              {selected && <span className="absolute -left-1 top-2 bottom-2 w-0.5 rounded-full bg-accent" />}
              <Icon strokeWidth={1.5} />
            </button>
          </Tip>
        );
      })}
    </nav>
  );
}

export function LibraryPanel({ tab }: { tab: LibraryTab }) {
  const info = LIBRARY_TABS.find((t) => t.id === tab)!;
  return (
    <section aria-label={info.label} className="flex h-full flex-col bg-bg-1">
      <header className="flex h-10 shrink-0 items-center justify-between px-3">
        <h2 className="text-title font-semibold">{info.label}</h2>
        {tab === "media" && (
          <Tip label="Importar (em breve)" shortcut="Ctrl+I">
            <Button size="sm" disabled>
              <Import /> Importar
            </Button>
          </Tip>
        )}
      </header>
      <EmptyState icon={info.icon} text={info.empty} />
    </section>
  );
}

export function EmptyState({ icon: Icon, text }: { icon: LucideIcon; text: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
      <Icon className="size-8 text-text-2" strokeWidth={1.25} />
      <p className="max-w-56 text-body text-text-2">{text}</p>
    </div>
  );
}
