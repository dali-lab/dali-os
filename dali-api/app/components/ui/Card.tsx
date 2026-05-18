import type { HTMLAttributes } from "react";
import { cn } from "~/lib/cn";

export type CardVariant = "card" | "brand-tint";

const VARIANTS: Record<CardVariant, string> = {
  // White content surface — the default panel.
  card: "bg-card border border-border",
  // Decorative brand-tinted info panel (no border by convention).
  "brand-tint": "bg-brand-tint",
};

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: CardVariant;
}

export function Card({ variant = "card", className, ...props }: CardProps) {
  return (
    <div
      className={cn("rounded-lg", VARIANTS[variant], className)}
      {...props}
    />
  );
}
