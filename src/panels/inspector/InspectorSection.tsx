/**
 * Padrão de tela "seção do inspetor": título com seta, conteúdo recolhível.
 * Cada seção (Transformação, Ajustes de cor, Efeitos, Áudio, Keyframes) usa este bloco.
 */
import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";

export function InspectorSection({
  title,
  defaultOpen = true,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="border-b border-border">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex h-9 w-full items-center gap-2 px-3 text-left text-label font-semibold uppercase tracking-wide text-text-2 hover:text-text-1"
      >
        <ChevronDown
          className={cn("size-3.5 transition-transform duration-[var(--duration-fast)]", !open && "-rotate-90")}
        />
        {title}
      </button>
      {open && <div className="flex flex-col gap-2 px-3 pb-3">{children}</div>}
    </section>
  );
}

/** Linha rótulo + valor dentro de uma seção. */
export function InspectorRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[96px_1fr] items-center gap-2 text-body">
      <span className="text-label text-text-2">{label}</span>
      <div className="min-w-0 text-text-1">{children}</div>
    </div>
  );
}
