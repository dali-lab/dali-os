import type { ButtonHTMLAttributes } from "react";
import { Loader2, type LucideIcon } from "lucide-react";
import { cn } from "~/lib/cn";

type AuthButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary";
  icon?: LucideIcon;
  loading?: boolean;
  loadingLabel?: string;
  /** The dali.os auth dress (desktop-tabs flag): accent fill / bordered dark. */
  v2?: boolean;
};

/** An auth-page action: the brand pill with a spinner that swaps in for the
 *  icon while its request is in flight, so the button itself says what's
 *  happening instead of the page going quiet. */
export function AuthButton({
  variant = "primary",
  icon: Icon,
  loading = false,
  loadingLabel,
  children,
  className,
  disabled,
  type = "button",
  v2 = false,
  ...rest
}: AuthButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading}
      className={cn(
        "group flex w-full items-center justify-center gap-2 text-sm font-semibold outline-none transition-[background-color,border-color,color,opacity,transform] duration-150 ease-out active:scale-[0.98] disabled:cursor-default disabled:opacity-50",
        v2
          ? cn(
              "h-10 rounded-lg font-os focus-visible:ring-2 focus-visible:ring-os-accent/40",
              variant === "primary"
                ? "bg-os-accent text-os-bg hover:bg-os-accent-hover"
                : "border border-os-container bg-transparent text-foreground hover:border-os-container-hi hover:bg-os-hover",
            )
          : cn(
              "rounded-xl py-3 font-heading focus-visible:ring-4 focus-visible:ring-dark-blue/20",
              variant === "primary"
                ? "bg-dark-blue text-white hover:opacity-90"
                : "border border-border bg-card text-dark-blue hover:border-accent-coral",
            ),
        className,
      )}
      {...rest}
    >
      <span key={loading ? "loading" : "idle"} className="flex items-center gap-2 motion-safe:animate-auth-digit">
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        ) : (
          Icon && (
            <Icon
              className="h-4 w-4 transition-transform duration-150 ease-out group-hover:-translate-y-px group-hover:scale-110"
              aria-hidden
            />
          )
        )}
        {loading ? (loadingLabel ?? children) : children}
      </span>
    </button>
  );
}
