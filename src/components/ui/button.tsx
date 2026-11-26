import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

/**
 * Botão base (shadcn/ui, adaptado aos tokens).
 * "accent" é reservado ao Exportar e a ações principais de diálogos.
 */
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-control text-body font-medium " +
    "transition-colors duration-[var(--duration-fast)] disabled:pointer-events-none disabled:opacity-40 " +
    "[&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-bg-2 text-text-1 border border-border hover:border-text-2",
        accent: "bg-accent text-accent-contrast hover:brightness-110",
        ghost: "text-text-2 hover:text-text-1 hover:bg-bg-2",
        danger: "bg-bg-2 text-danger border border-border hover:border-danger",
      },
      size: {
        sm: "h-7 px-2",
        md: "h-8 px-3",
        icon: "size-8",
      },
    },
    defaultVariants: { variant: "default", size: "md" },
  },
);

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}

export function Button({ className, variant, size, type = "button", ...props }: ButtonProps) {
  return <button type={type} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
