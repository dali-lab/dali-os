import type { ButtonHTMLAttributes } from "react";
import { Loader2, type LucideIcon } from "lucide-react";
import { cn } from "~/lib/cn";

type AuthButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary";
  icon?: LucideIcon;
  loading?: boolean;
  loadingLabel?: string;
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
  ...rest
}: AuthButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading}
      className={cn(
        "group flex w-full items-center justify-center gap-2 rounded-xl py-3 font-heading text-sm font-semibold outline-none transition-[background-color,border-color,color,opacity,transform] duration-150 ease-out active:scale-[0.98] focus-visible:ring-4 focus-visible:ring-dark-blue/20 disabled:cursor-default",
        variant === "primary"
          ? "bg-dark-blue text-white hover:opacity-90 disabled:opacity-50"
          : "border border-border bg-card text-dark-blue hover:border-accent-coral disabled:opacity-50",
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
