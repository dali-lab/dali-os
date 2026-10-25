import { Link } from "react-router";
import { ArrowLeft } from "lucide-react";

/** The way up from a journey page, in place of the shell's breadcrumbs. */
export function BackLink({ to, children }: { to: string; children: string }) {
  return (
    <Link to={to} className="inline-flex items-center gap-1.5 text-sm text-os-grey transition-colors hover:text-foreground">
      <ArrowLeft className="h-4 w-4" aria-hidden />
      {children}
    </Link>
  );
}
