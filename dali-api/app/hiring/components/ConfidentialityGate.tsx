import { Link } from "react-router";
import { ShieldAlert, ShieldOff } from "lucide-react";
import { buttonClasses } from "~/components/ui/Button";
import { cn } from "~/lib/cn";

interface ConfidentialityGateProps {
  cycleId: string;
  /** "no_agreement" or "unsigned". */
  reason: "no_agreement" | "unsigned";
  /** Path to return to after signing. */
  next?: string;
  className?: string;
}

export function ConfidentialityGate({
  cycleId,
  reason,
  next,
  className,
}: ConfidentialityGateProps) {
  const href =
    `/hiring/cycles/${cycleId}/confidentiality` +
    (next ? `?next=${encodeURIComponent(next)}` : "");

  if (reason === "no_agreement") {
    return (
      <div
        className={cn(
          "flex flex-col items-center rounded-lg border border-dashed border-border bg-muted/30 px-4 py-6 text-center",
          className,
        )}
      >
        <span className="mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-yellow-100 text-yellow-700">
          <ShieldOff className="h-5 w-5" aria-hidden />
        </span>
        <p className="text-sm font-medium text-foreground">
          This section is hidden until the hiring lead binds a confidentiality
          agreement to the cycle.
        </p>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex flex-col items-center rounded-lg border border-border bg-muted/30 px-4 py-6 text-center",
        className,
      )}
    >
      <span className="mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-brand-tint text-accent-coral">
        <ShieldAlert className="h-5 w-5" aria-hidden />
      </span>
      <p className="text-sm font-medium text-foreground">
        Read and sign the confidentiality agreement to view this section.
      </p>
      <Link to={href} className={buttonClasses("primary", "sm", "mt-3")}>
        Read &amp; sign
      </Link>
    </div>
  );
}
