import type { ButtonHTMLAttributes } from "react";
import { cn } from "~/lib/cn";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "destructive";
export type ButtonSize = "sm" | "md";

const BASE =
  "inline-flex items-center justify-center gap-2 rounded-full font-semibold font-heading transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-teal focus-visible:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none";

const VARIANTS: Record<ButtonVariant, string> = {
  // DALI brand coral ("Sunrise") is the single primary action across the app.
  // Hover promotes elevation one level and shifts to the light coral variant,
  // per guide §8.1.
  primary:
    "bg-accent-coral text-white shadow-brand-1 hover:bg-accent-coral-light hover:shadow-brand-2",
  // Navy outline secondary — guide §8.1 outline pill recipe.
  secondary:
    "bg-card text-dark-blue border-2 border-dark-blue hover:bg-dark-blue hover:text-white",
  ghost: "text-muted-foreground hover:text-foreground hover:bg-muted",
  destructive:
    "bg-destructive text-destructive-foreground shadow-brand-1 hover:bg-destructive/90 hover:shadow-brand-2",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "px-4 py-1.5 text-xs",
  md: "px-6 py-2.5 text-sm",
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
  return cn(BASE, VARIANTS[variant], SIZES[size], className);
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
