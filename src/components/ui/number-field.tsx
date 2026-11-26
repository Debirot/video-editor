/**
 * Campo numérico do inspetor: digitar (Enter confirma, Esc desiste), setas ↑/↓ (Shift = ×10)
 * e arrastar o rótulo para os lados (scrub). Quem usa decide o que é "um passo de desfazer":
 * onScrubStart/onScrubEnd envolvem o arrasto numa transação.
 */
import { useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";

export interface NumberFieldProps {
  label: ReactNode;
  value: number;
  onChange: (value: number) => void;
  /** Converte o valor em texto (com unidade). */
  format: (value: number) => string;
  /** Lê o texto digitado; null = inválido (volta ao valor atual). */
  parse: (text: string) => number | null;
  step: number;
  min?: number;
  max?: number;
  /** Pixels de arrasto por passo. */
  pxPerStep?: number;
  onScrubStart?: () => void;
  onScrubEnd?: () => void;
  disabled?: boolean;
}

export function NumberField({
  label,
  value,
  onChange,
  format,
  parse,
  step,
  min = -Infinity,
  max = Infinity,
  pxPerStep = 4,
  onScrubStart,
  onScrubEnd,
  disabled,
}: NumberFieldProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const scrub = useRef<{ x0: number; v0: number } | null>(null);
  const clamp = (v: number) => Math.min(max, Math.max(min, v));

  const commit = () => {
    if (draft === null) return;
    const parsed = parse(draft);
    setDraft(null);
    if (parsed !== null && clamp(parsed) !== value) onChange(clamp(parsed));
  };

  return (
    <div className={cn("grid grid-cols-[96px_1fr] items-center gap-2", disabled && "opacity-40")}>
      <span
        className={cn("select-none text-label text-text-2", !disabled && "cursor-ew-resize hover:text-text-1")}
        title="Arraste para os lados para ajustar"
        onPointerDown={(e) => {
          if (disabled || e.button !== 0) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          scrub.current = { x0: e.clientX, v0: value };
          onScrubStart?.();
        }}
        onPointerMove={(e) => {
          const s = scrub.current;
          if (!s) return;
          const steps = Math.round((e.clientX - s.x0) / pxPerStep) * (e.shiftKey ? 10 : 1);
          const next = clamp(s.v0 + steps * step);
          if (next !== value) onChange(next);
        }}
        onPointerUp={() => {
          if (!scrub.current) return;
          scrub.current = null;
          onScrubEnd?.();
        }}
      >
        {label}
      </span>
      <input
        className="tabular h-7 min-w-0 rounded-control border border-border bg-bg-2 px-2 text-body text-text-1 outline-none focus:border-accent"
        value={draft ?? format(value)}
        disabled={disabled}
        spellCheck={false}
        onFocus={(e) => {
          setDraft(format(value));
          e.currentTarget.select();
        }}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          else if (e.key === "Escape") {
            setDraft(null);
            requestAnimationFrame(() => (e.target as HTMLInputElement).blur());
          } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            const next = clamp(value + (e.key === "ArrowUp" ? 1 : -1) * step * (e.shiftKey ? 10 : 1));
            setDraft(null);
            onChange(next);
          }
        }}
      />
    </div>
  );
}

/** "−6,5" / "0,25": vírgula decimal e sinal de menos tipográfico. */
export function formatDecimal(v: number, digits: number): string {
  return v.toFixed(digits).replace(".", ",").replace("-", "−");
}

/** Lê "−6,5", "-6.5", "6,5 dB", "0.25s": primeiro número do texto. */
export function parseDecimal(text: string): number | null {
  const m = /[-−]?\d+(?:[.,]\d+)?/.exec(text);
  return m ? Number(m[0].replace(",", ".").replace("−", "-")) : null;
}
