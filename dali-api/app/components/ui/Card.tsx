import type { HTMLAttributes } from "react";
import { cn } from "~/lib/cn";

export type CardVariant = "card" | "brand-tint";

const VARIANTS: Record<CardVariant, string> = {
  // White content surface — the default panel. Paired with brand shadow-1.
  card: "bg-card border border-border shadow-brand-1",
  // Decorative brand-tinted info panel (no border, deeper shadow per §3.2 pairing).
  "brand-tint": "bg-brand-tint shadow-brand-2",
};

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: CardVariant;
}

export function Card({ variant = "card", className, ...props }: CardProps) {
  return (
    <div
      className={cn("rounded-lg transition-shadow duration-300", VARIANTS[variant], className)}
      {...props}
    />
  );
}
