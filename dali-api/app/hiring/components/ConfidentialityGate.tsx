import { Link } from "react-router";
import { ShieldAlert, ShieldOff } from "lucide-react";
import { buttonClasses } from "~/components/ui/Button";

interface ConfidentialityGateProps {
  cycleId: string;
  /** "no_agreement" or "unsigned". */
  reason: "no_agreement" | "unsigned";
  /** Path to return to after signing. */
  next?: string;
  /** Names the cycle, for pages that show more than one. */
  cycleName?: string;
  className?: string;
}

export function ConfidentialityGate({
  cycleId,
  reason,
  next,
  cycleName,
  className,
}: ConfidentialityGateProps) {
  const href =
    `/hiring/cycles/${cycleId}/confidentiality` +
    (next ? `?next=${encodeURIComponent(next)}` : "");

  if (reason === "no_agreement") {
    return (
      <div
        className={
          "rounded-lg border border-os-amber/40 bg-os-amber/10 px-4 py-6 text-center " +
          (className ?? "")
        }
      >
        <ShieldOff className="w-6 h-6 text-os-amber mx-auto mb-2" />
        <p className="text-sm text-os-amber font-medium">
          {cycleName
            ? `${cycleName} data is hidden until the hiring lead binds a confidentiality agreement.`
            : "Sensitive data is hidden until the hiring lead binds a confidentiality agreement to this cycle."}
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
        {cycleName
          ? `Sign the ${cycleName} confidentiality agreement to see its applications.`
          : "Sign the confidentiality agreement to view this section."}
      </p>
      <Link
        to={href}
        className={buttonClasses("primary", "md")}
      >
        Sign agreement
      </Link>
    </div>
  );
}
