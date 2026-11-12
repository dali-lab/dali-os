import { Link } from "react-router";
import { AssignmentWorkArea } from "~/education/components/AssignmentWorkArea";
import { formatDateTime } from "~/lib/display";
import { useUserTimeZone } from "~/hooks/useUserTimeZone";
import type { OfferingSurface } from "~/education/lib/offering-surface";

type AssignmentViewProps = {
  surface: OfferingSurface;
  offeringId: string;
  assignment: Parameters<typeof AssignmentWorkArea>[0]["assignment"] & { title: string; dueAt?: string | Date | null };
  submission: Parameters<typeof AssignmentWorkArea>[0]["submission"];
  canSubmit: boolean;
  collabToken: Parameters<typeof AssignmentWorkArea>[0]["collabToken"];
  userName: string;
};

export function AssignmentView({
  surface,
  offeringId,
  assignment,
  submission,
  canSubmit,
  collabToken,
  userName,
}: AssignmentViewProps) {
  const tz = useUserTimeZone();
  const portal = surface.kind === "portal";
  return (
    <div className={portal ? "w-full px-4 sm:px-6 py-8 flex flex-col gap-4" : "flex flex-col gap-4"}>
      <header>
        {portal && (
          <p className="text-xs text-muted-foreground">
            <Link to={`${surface.base}/${offeringId}/hub?tab=assignments`} className="hover:underline">
              ← Assignments
            </Link>
          </p>
        )}
        <h1
          className={
            portal
              ? "mt-1 font-heading text-4xl font-medium text-foreground"
              : "font-heading text-2xl font-bold text-foreground"
          }
        >
          {assignment.title}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          {assignment.dueAt
            ? `Due ${formatDateTime(assignment.dueAt, portal ? undefined : tz)}`
            : "No due date"}
        </p>
      </header>
      <AssignmentWorkArea
        assignment={assignment}
        submission={submission}
        canSubmit={canSubmit}
        collabToken={collabToken}
        userName={userName}
      />
    </div>
  );
}
