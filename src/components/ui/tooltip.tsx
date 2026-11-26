/**
 * Tooltip (Radix, padrão shadcn/ui). Use <Tip> para o caso comum: rótulo e atalho.
 * O TooltipProvider fica uma vez só, em App.tsx.
 */
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/cn";

export const TooltipProvider = TooltipPrimitive.Provider;
export const Tooltip = TooltipPrimitive.Root;
export const TooltipTrigger = TooltipPrimitive.Trigger;

export function TooltipContent({ className, sideOffset = 6, ...props }: ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        sideOffset={sideOffset}
        className={cn(
          "z-50 rounded-control border border-border bg-bg-2 px-2 py-1 text-label text-text-1 shadow-lg",
          className,
        )}
        {...props}
      />
    </TooltipPrimitive.Portal>
  );
}

/**
 * Envolve um controle com tooltip. Botões desabilitados não recebem eventos de
 * ponteiro, então o gatilho é um <span> em volta do filho.
 */
export function Tip({
  label,
  shortcut,
  side,
  children,
}: {
  label: string;
  shortcut?: string;
  side?: "top" | "bottom" | "left" | "right";
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex">{children}</span>
      </TooltipTrigger>
      <TooltipContent side={side}>
        {label}
        {shortcut && <span className="ml-2 text-text-2">{shortcut}</span>}
      </TooltipContent>
    </Tooltip>
  );
}
