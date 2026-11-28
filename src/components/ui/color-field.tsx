/**
 * Campo de cor do inspetor: amostra que abre o seletor de cor do sistema e o código
 * "#RRGGBB" editável (Enter confirma, Esc desiste). Com `noneFallback`, um botão alterna
 * entre "sem cor" e a última cor usada (ou `noneFallback`, se o valor já começou sem cor).
 * Escolher no seletor dispara várias mudanças seguidas: onPickStart/onPickEnd deixam
 * quem usa envolvê-las numa transação (um passo de desfazer), como o arrasto do NumberField.
 */
import { useEffect, useRef, useState } from "react";
import { Ban } from "lucide-react";
import { cn } from "@/lib/cn";

/** "#f80", "FF8800", "#ff8800" → "#ff8800"; inválido → null. */
export function parseHexColor(text: string): string | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(text.trim());
  if (!m) return null;
  const hex = m[1]!.length === 3 ? [...m[1]!].map((c) => c + c).join("") : m[1]!;
  return `#${hex.toLowerCase()}`;
}

export interface ColorFieldProps {
  label: string;
  /** "#rrggbb", ou "none" quando há `noneFallback`. */
  value: string;
  onChange: (value: string) => void;
  onPickStart?: () => void;
  onPickEnd?: () => void;
  /** Liga o botão "sem cor" (valor "none"); é a cor usada ao religar se não houver outra. */
  noneFallback?: string;
  disabled?: boolean;
}

export function ColorField({ label, value, onChange, onPickStart, onPickEnd, noneFallback, disabled }: ColorFieldProps) {
  const allowNone = noneFallback !== undefined;
  const none = value === "none";
  const [draft, setDraft] = useState<string | null>(null);
  // Última cor de verdade: volta quando "sem cor" é desligado.
  const [lastColor, setLastColor] = useState(none ? (noneFallback ?? value) : value);
  if (!none && value !== lastColor) setLastColor(value);
  const picker = useRef<HTMLInputElement>(null);
  const picking = useRef(false);
  const handlers = useRef({ onPickEnd });
  useEffect(() => {
    handlers.current = { onPickEnd };
  });

  // O "change" nativo (seletor fechado) marca o fim; o onChange do React é o "input".
  useEffect(() => {
    const el = picker.current!;
    const end = () => {
      if (!picking.current) return;
      picking.current = false;
      handlers.current.onPickEnd?.();
    };
    el.addEventListener("change", end);
    el.addEventListener("blur", end);
    return () => {
      el.removeEventListener("change", end);
      el.removeEventListener("blur", end);
    };
  }, []);

  const commitDraft = () => {
    if (draft === null) return;
    const parsed = parseHexColor(draft);
    setDraft(null);
    if (parsed && parsed !== value) onChange(parsed);
  };

  return (
    <div className={cn("grid grid-cols-[96px_1fr] items-center gap-2", disabled && "opacity-40")}>
      <span className="text-label text-text-2">{label}</span>
      <div className="flex min-w-0 items-center gap-2">
        <label
          className={cn(
            "relative flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-control border border-border bg-bg-2",
            !disabled && "cursor-pointer hover:border-text-2",
          )}
          style={none ? undefined : { background: value }}
          title="Escolher cor"
        >
          {none && <Ban className="size-4 text-text-2" strokeWidth={1.5} />}
          <input
            ref={picker}
            type="color"
            aria-label={label}
            className="absolute inset-0 cursor-pointer opacity-0"
            value={none ? lastColor : value}
            disabled={disabled}
            onChange={(e) => {
              if (!picking.current) {
                picking.current = true;
                onPickStart?.();
              }
              onChange(e.target.value.toLowerCase());
            }}
          />
        </label>
        <input
          className={cn(
            "tabular h-7 min-w-0 flex-1 rounded-control border border-border bg-bg-2 px-2 font-mono text-body text-text-1 outline-none focus:border-accent",
            !none && draft === null && "uppercase",
          )}
          aria-label={`${label} (código)`}
          value={draft ?? (none ? "Nenhuma" : value)}
          disabled={disabled}
          spellCheck={false}
          onFocus={(e) => {
            setDraft(none ? "" : value);
            requestAnimationFrame(() => e.target.select());
          }}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitDraft}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            else if (e.key === "Escape") {
              setDraft(null);
              requestAnimationFrame(() => (e.target as HTMLInputElement).blur());
            }
          }}
        />
        {allowNone && (
          <button
            type="button"
            disabled={disabled}
            aria-pressed={none}
            title={none ? "Usar cor" : "Sem cor"}
            aria-label={none ? `${label}: usar cor` : `${label}: sem cor`}
            onClick={() => onChange(none ? lastColor : "none")}
            className={cn(
              "flex size-7 shrink-0 items-center justify-center rounded-control text-text-2 hover:bg-bg-2 hover:text-text-1 [&_svg]:size-4",
              none && "bg-bg-2 text-accent",
            )}
          >
            <Ban strokeWidth={1.5} />
          </button>
        )}
      </div>
    </div>
  );
}
