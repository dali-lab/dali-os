import { Link } from "react-router";
import { Eye, Pencil } from "lucide-react";
import { buttonClasses } from "~/components/ui/Button";

export function PreviewBanner({ editHref }: { editHref: string }) {
  return (
    <div role="status" className="flex shrink-0 flex-wrap items-center justify-between gap-3 rounded-os-card bg-os-accent/10 px-4 py-3">
      <p className="flex items-center gap-2 text-sm text-foreground">
        <Eye className="h-4 w-4 shrink-0 text-os-accent" aria-hidden />
        <span>
          <span className="font-medium">Learner preview.</span> You're seeing the saved draft with every module open.
          Nothing you do here is saved.
        </span>
      </p>
      <Link to={editHref} className={buttonClasses("secondary", "sm")}>
        <Pencil className="h-3.5 w-3.5" aria-hidden />
        Back to editor
      </Link>
    </div>
  );
}
