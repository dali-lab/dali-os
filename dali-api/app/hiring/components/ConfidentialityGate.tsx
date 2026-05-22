import { Link } from "react-router";
import { ShieldAlert, ShieldOff } from "lucide-react";

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
        className={
          "rounded-lg border border-amber-200 bg-amber-50 px-4 py-6 text-center " +
          (className ?? "")
        }
      >
        <ShieldOff className="w-6 h-6 text-amber-500 mx-auto mb-2" />
        <p className="text-sm text-amber-900 font-medium">
          Sensitive data is hidden until the hiring lead binds a confidentiality
          agreement to this cycle.
        </p>
      </div>
    );
  }

  return (
    <div
      className={
        "rounded-lg border border-border bg-muted/30 px-4 py-6 text-center " +
        (className ?? "")
      }
    >
      <ShieldAlert className="w-6 h-6 text-blue-600 mx-auto mb-2" />
      <p className="text-sm text-foreground/80 font-medium">
        Sign the confidentiality agreement to view this section.
      </p>
      <Link
        to={href}
        className="mt-3 inline-block px-3 py-2 text-sm font-medium text-white bg-accent-coral rounded-md hover:bg-accent-coral/90"
      >
        Sign agreement
      </Link>
    </div>
  );
}
