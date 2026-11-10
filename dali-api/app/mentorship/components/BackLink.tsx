import { ArrowLeft } from "lucide-react";
import { Link, useLocation, useNavigate } from "react-router";

/**
 * "← Back to …" for pages reached from another mentorship page. When the
 * viewer arrived by an in-app navigation, it steps back through history, so
 * the previous page's URL (search + filters) and scroll position are restored
 * by the router. Opened directly (new tab, shared link), it falls back to a
 * plain link to `to`.
 */
export function BackLink({ to, children }: { to: string; children: React.ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();
  return (
    <Link
      to={to}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
        // "default" is the key of the first entry in this tab's session.
        if (location.key !== "default") {
          e.preventDefault();
          navigate(-1);
        }
      }}
      className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
    >
      <ArrowLeft className="h-4 w-4" aria-hidden />
      {children}
    </Link>
  );
}
