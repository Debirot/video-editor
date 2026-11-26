/**
 * Painéis redimensionáveis (react-resizable-panels v4), no estilo do shadcn/ui.
 * O separador é uma linha de 1 px; a área de clique é maior (biblioteca cuida disso).
 */
import { Group, Panel, Separator, type GroupProps, type PanelProps } from "react-resizable-panels";
import { cn } from "@/lib/cn";

export function ResizableGroup({ className, ...props }: GroupProps) {
  return <Group className={cn("h-full w-full", className)} {...props} />;
}

export function ResizablePanel(props: PanelProps) {
  return <Panel {...props} />;
}

/** `direction` é a orientação do grupo: "horizontal" desenha uma linha vertical. */
export function ResizableHandle({ direction, className }: { direction: "horizontal" | "vertical"; className?: string }) {
  return (
    <Separator
      className={cn(
        "shrink-0 bg-border outline-none transition-colors duration-[var(--duration-fast)]",
        "data-[separator=hover]:bg-text-2 data-[separator=active]:bg-accent data-[separator=focus]:bg-accent",
        direction === "horizontal" ? "w-px" : "h-px",
        className,
      )}
    />
  );
}
