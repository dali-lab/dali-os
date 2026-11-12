import type { ReactNode } from "react";
import { cn } from "~/lib/cn";

export const PILL_TONES = {
  neutral: "bg-os-container text-os-grey",
  accent: "bg-os-accent/15 text-os-accent",
  success: "bg-os-green/15 text-os-green",
  warning: "bg-os-amber/15 text-os-amber",
  danger: "bg-destructive/15 text-destructive",
} as const;

export type PillTone = keyof typeof PILL_TONES;

// The edge ramp holds one middle strength across hues in both themes; os-green and os-amber swing to deep inks in light.
export const DOT_TONES: Record<PillTone, string> = {
  neutral: "bg-os-grey",
  accent: "bg-[var(--os-status-progress-edge)]",
  success: "bg-[var(--os-status-done-edge)]",
  warning: "bg-[var(--os-status-review-edge)]",
  danger: "bg-os-red",
};

export type PillSize = "xs" | "sm" | "md";

const SIZES: Record<PillSize, string> = {
  md: "px-3 py-1 text-sm",
  sm: "whitespace-nowrap px-2.5 py-0.5 text-xs",
  xs: "whitespace-nowrap px-1.5 py-0.5 text-[10px]",
};

export function Pill({
  tone = "neutral",
  dot,
  outline = false,
  size = "md",
  className,
  children,
}: {
  tone?: PillTone;
  /** Colour the state as a leading dot and keep the chip neutral. */
  dot?: PillTone;
  /** No fill, just a hairline border: the applicant-facing dress. */
  outline?: boolean;
  size?: PillSize;
  className?: string;
  children: ReactNode;
}) {
  const quiet = size === "sm" && !outline && (dot !== undefined || tone === "neutral");
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full font-medium",
        SIZES[size],
        outline
          ? "border border-os-container text-os-grey"
          : quiet
            ? "bg-os-container/70 text-foreground"
            : PILL_TONES[dot ? "neutral" : tone],
        className,
      )}
    >
      {dot && <span className={cn("h-2 w-2 shrink-0 rounded-full", DOT_TONES[dot])} aria-hidden />}
      {children}
    </span>
  );
}
