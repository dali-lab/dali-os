import type { ButtonHTMLAttributes } from "react";
import { cn } from "~/lib/cn";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "destructive";
export type ButtonSize = "sm" | "md";

const BASE =
  "inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-coral/30 focus-visible:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none";

const VARIANTS: Record<ButtonVariant, string> = {
  // DALI brand coral ("Sunrise") is the single primary action across the app.
  primary:
    "bg-accent-coral text-white hover:bg-accent-coral/90",
  secondary:
    "bg-card text-foreground border border-border hover:bg-muted",
  ghost: "text-muted-foreground hover:text-foreground hover:bg-muted",
  destructive:
    "bg-destructive text-destructive-foreground hover:bg-destructive/90",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "px-3 py-1.5 text-xs",
  md: "px-4 py-2 text-sm",
};

/**
 * Shared class string for button-styled elements. Use this directly on
 * `<Link>` / `<a>` / `Form` submit buttons so they match the `Button`
 * component without needing a polymorphic wrapper.
 */
export function buttonClasses(
  variant: ButtonVariant = "primary",
  size: ButtonSize = "md",
  className?: string,
): string {
  // The `dali-btn--*` marker carries the button's *role* in the markup, which
  // the utility classes above only encode as colours. The dali.os shell
  // restyles buttons off it (see app.css), so one theme lands on every button
  // in the app — dialog footers included — instead of each caller opting in.
  return cn(BASE, `dali-btn dali-btn--${variant}`, VARIANTS[variant], SIZES[size], className);
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export function Button({
  variant = "primary",
  size = "md",
  className,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={buttonClasses(variant, size, className)}
      {...props}
    />
  );
}
