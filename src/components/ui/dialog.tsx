/**
 * Diálogo modal (Radix, padrão shadcn/ui), com os tokens do app.
 * Padrão de tela: título, descrição curta, conteúdo, rodapé com ações à direita
 * (a principal em accent, por último).
 */
import * as DialogPrimitive from "@radix-ui/react-dialog";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/cn";

export const Dialog = DialogPrimitive.Root;
export const DialogClose = DialogPrimitive.Close;

export function DialogContent({
  className,
  children,
  ...props
}: ComponentProps<typeof DialogPrimitive.Content>) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-bg-0/70" />
      <DialogPrimitive.Content
        className={cn(
          "fixed top-1/2 left-1/2 z-50 flex w-[480px] max-w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 flex-col gap-4",
          "rounded-panel border border-border bg-bg-1 p-5 shadow-2xl outline-none",
          className,
        )}
        {...props}
      >
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function DialogHeader({ title, description }: { title: string; description?: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <DialogPrimitive.Title className="text-title font-semibold text-text-1">{title}</DialogPrimitive.Title>
      {description ? (
        <DialogPrimitive.Description className="text-body text-text-2">{description}</DialogPrimitive.Description>
      ) : (
        <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>
      )}
    </div>
  );
}

export function DialogFooter({ children }: { children: ReactNode }) {
  return <div className="mt-2 flex justify-end gap-2">{children}</div>;
}

/** Campo do formulário: rótulo à esquerda, controle à direita. */
export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="grid grid-cols-[120px_1fr] items-center gap-3 text-body">
      <span className="text-label text-text-2">{label}</span>
      <span className="flex min-w-0 flex-col gap-0.5">
        {children}
        {hint && <span className="text-label text-text-2">{hint}</span>}
      </span>
    </label>
  );
}

/** Select nativo com os tokens (sem outra biblioteca de UI). */
export function Select({ className, ...props }: ComponentProps<"select">) {
  return (
    <select
      className={cn(
        "h-8 rounded-control border border-border bg-bg-2 px-2 text-body text-text-1 outline-none focus:border-accent disabled:opacity-40",
        className,
      )}
      {...props}
    />
  );
}
