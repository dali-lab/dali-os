import type { InputHTMLAttributes, ReactNode } from "react";
import { Link } from "react-router";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import { cn } from "~/lib/cn";
import { AnimatedTileCluster } from "~/components/auth/AnimatedTileCluster";

// The dali.os auth dress (desktop-tabs flag): a dark os-shell split screen —
// brand panel with the animated tile cluster on the left, a step-animated form
// column on the right. The legacy brand-tint shell stays in AuthShell.tsx for
// the flag-off path.

export function AuthShellV2({
  title,
  stepKey,
  error,
  notice,
  children,
}: {
  title: string;
  /** Changing this re-runs the form column's entrance, so steps read as advancing. */
  stepKey?: string;
  error?: string | null;
  notice?: string | null;
  children: ReactNode;
}) {
  return (
    <div className="os-shell flex min-h-screen w-full bg-os-bg font-os text-foreground antialiased">
      <aside className="relative hidden min-h-screen w-1/2 flex-col overflow-hidden bg-os-nav md:flex">
        <div className="relative z-10 flex flex-1 flex-col justify-center gap-6 px-12 pb-8 pt-12 lg:px-16">
          <span className="font-os-logo text-2xl font-semibold text-os-accent motion-safe:animate-auth-rise">
            dali.os
          </span>
          <h2 className="font-os text-4xl font-extrabold leading-[1.1] tracking-tight text-foreground lg:text-5xl">
            <span className="block motion-safe:animate-auth-rise" style={{ animationDelay: "80ms" }}>
              Welcome to
            </span>
            <span className="block text-os-accent motion-safe:animate-auth-rise" style={{ animationDelay: "160ms" }}>
              DALI OS
            </span>
          </h2>
          <p
            className="max-w-sm text-base leading-relaxed text-os-grey motion-safe:animate-auth-rise"
            style={{ animationDelay: "260ms" }}
          >
            Dartmouth&apos;s experiential learning lab — where students build real products for real partners.
          </p>
        </div>
        <div className="relative w-full">
          <AnimatedTileCluster />
        </div>
      </aside>

      <main className="flex min-h-screen w-full flex-col items-center justify-center px-6 py-12 md:w-1/2 md:px-12 lg:px-16">
        <div className="w-full max-w-sm">
          <span className="mb-8 block font-os-logo text-2xl font-semibold text-os-accent md:hidden">dali.os</span>

          <div key={stepKey ?? title} className="motion-safe:animate-auth-rise">
            <h1 className="mb-6 font-os text-[28px] font-extrabold leading-tight tracking-tight text-foreground">
              {title}
            </h1>
            <AuthNotice message={error ?? null} />
            <AuthNotice message={notice ?? null} tone="success" />
            {children}
          </div>

          {/* Public policy links. The login page doubles as the app's public
              home page for Google OAuth verification, which requires the home
              page to link to the privacy policy. */}
          <footer className="mt-10 flex items-center gap-4 text-xs text-os-muted">
            <a href="/privacy" className="underline transition-colors hover:text-foreground">
              Privacy Policy
            </a>
            <a href="/terms" className="underline transition-colors hover:text-foreground">
              Terms of Service
            </a>
          </footer>
        </div>
      </main>
    </div>
  );
}

/** Rises in, and shakes when it carries an error. */
export function AuthNotice({ message, tone = "error" }: { message: string | null; tone?: "error" | "success" }) {
  if (!message) return null;
  const Icon = tone === "error" ? AlertCircle : CheckCircle2;
  return (
    <div
      key={message}
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "mb-5 flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm",
        tone === "error"
          ? "border-[color-mix(in_srgb,var(--os-danger-ink)_30%,transparent)] bg-[color-mix(in_srgb,var(--os-danger-ink)_10%,transparent)] text-[var(--os-danger-ink)] motion-safe:animate-[auth-rise_280ms_cubic-bezier(0.23,1,0.32,1)_both,dali-shake_360ms_ease-in-out_150ms_2]"
          : "border-os-green/30 bg-os-green/10 text-os-green motion-safe:animate-auth-rise",
      )}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <span>{message}</span>
    </div>
  );
}

const FIELD_CLASS =
  "h-10 w-full rounded-lg border border-os-container bg-os-well px-3 text-sm text-foreground placeholder:text-os-muted transition-colors hover:border-os-container-hi focus:border-os-accent focus:outline-none focus:ring-2 focus:ring-os-accent/25";

export function AuthInput({
  label,
  hint,
  id,
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }) {
  const inputId = id ?? `auth-${label.toLowerCase().replace(/\s+/g, "-")}`;
  return (
    <label htmlFor={inputId} className="flex flex-col gap-1.5">
      <span className="flex items-baseline justify-between text-xs font-semibold text-os-grey">
        {label}
        {hint && <span className="font-normal text-os-muted">{hint}</span>}
      </span>
      <input
        id={inputId}
        className={cn(FIELD_CLASS, "disabled:cursor-not-allowed disabled:bg-os-card/60 disabled:text-os-grey", className)}
        {...props}
      />
    </label>
  );
}

export function AuthDivider({ label = "or" }: { label?: string }) {
  return (
    <div className="my-5 flex items-center gap-3 text-xs font-semibold text-os-muted" role="separator">
      <span className="h-px flex-1 bg-os-container" />
      {label}
      <span className="h-px flex-1 bg-os-container" />
    </div>
  );
}

export function AuthFooterLink({ prompt, label, to }: { prompt: string; label: string; to: string }) {
  return (
    <p className="mt-6 text-sm text-os-grey">
      {prompt}{" "}
      <Link to={to} className="font-semibold text-os-accent transition-colors hover:text-os-accent-hover">
        {label}
      </Link>
    </p>
  );
}
