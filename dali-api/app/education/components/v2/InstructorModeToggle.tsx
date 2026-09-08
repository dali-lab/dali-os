import { Link, useSearchParams } from "react-router";
import { cn } from "~/lib/cn";

/**
 * Segmented control: "Editing" (instructor view) vs "As student" (preview).
 * Editing = plain hub URL (drops ?as param, preserves ?tab).
 * As student = ?as=student (plus current ?tab).
 */
export function InstructorModeToggle({ basePath }: { basePath: string }) {
  const [searchParams] = useSearchParams();
  const isStudentView = searchParams.get("as") === "student";
  const tab = searchParams.get("tab");

  const editingHref = tab ? `${basePath}/hub?tab=${tab}` : `${basePath}/hub`;
  const studentHref = tab ? `${basePath}/hub?as=student&tab=${tab}` : `${basePath}/hub?as=student`;

  return (
    <div className="inline-flex items-center rounded-full border border-border bg-muted p-0.5 text-sm font-medium">
      <Link
        to={editingHref}
        className={cn(
          "rounded-full px-3 py-1 transition-colors whitespace-nowrap",
          !isStudentView
            ? "bg-foreground text-background"
            : "text-muted-foreground hover:text-foreground",
        )}
      >
        Editing
      </Link>
      <Link
        to={studentHref}
        className={cn(
          "rounded-full px-3 py-1 transition-colors whitespace-nowrap",
          isStudentView
            ? "bg-foreground text-background"
            : "text-muted-foreground hover:text-foreground",
        )}
      >
        As student
      </Link>
    </div>
  );
}
