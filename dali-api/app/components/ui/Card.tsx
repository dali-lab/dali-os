import type { HTMLAttributes } from "react";
import { cn } from "~/lib/cn";

export type CardVariant = "card" | "brand-tint";

const VARIANTS: Record<CardVariant, string> = {
  // The default panel: the os card plane with its hairline, no cast shadow.
  card: "bg-card border border-border",
  // Tinted info panel. Under the shell the tint resolves to the card plane.
  "brand-tint": "bg-brand-tint border border-border",
};

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: CardVariant;
}

export function Card({ variant = "card", className, ...props }: CardProps) {
  return (
    <div
      className={cn("rounded-os-card", VARIANTS[variant], className)}
      {...props}
    />
  );
}
