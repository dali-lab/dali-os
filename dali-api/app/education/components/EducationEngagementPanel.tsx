import { formatDateShort } from "~/lib/display";
import { useUserTimeZone } from "~/hooks/useUserTimeZone";
import { TypeBadge, MyStatusChip } from "./OfferingCard";
import { InfoTip } from "~/components/ui/floating";

// "Past DALI education" panel on the hiring application views: what this
// applicant attended, how consistently they showed up, and what instructors
// said. Rendered only behind reviewer access + confidentiality gates —
// `internalNote` is hiring-only and must never reach a student surface.

export type EngagementRow = {
  offeringId: string;
  title: string;
  type: "Miniseries" | "Workshop";
  startsAt: string | Date | null;
  endsAt: string | Date | null;
  status: string;
  attendance: { present: number; excused: number; total: number };
  certificateIssuedAt: string | Date | null;
  feedback: string | null;
  internalNote: string | null;
};

export function EducationEngagementPanel({ entries }: { entries: EngagementRow[] }) {
  const tz = useUserTimeZone();
  if (entries.length === 0) return null;
  return (
    <section className="bg-card border border-border rounded-lg">
      <div className="px-6 py-4 border-b border-border">
        <h2 className="font-heading font-bold text-foreground">
          Past DALI education
        </h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          Workshops and miniseries this applicant engaged with — attendance and
          instructor comments are internal to hiring.
        </p>
      </div>
      <ul className="divide-y divide-border">
        {entries.map((e) => (
          <li key={e.offeringId} className="px-6 py-4">
            <div className="flex flex-wrap items-center gap-2">
              <TypeBadge type={e.type} />
              <span className="text-sm font-semibold text-foreground">{e.title}</span>
              <MyStatusChip status={e.status} />
              <span className="text-xs text-muted-foreground">
                {e.startsAt && e.endsAt
                ? `${formatDateShort(e.startsAt, tz)} – ${formatDateShort(e.endsAt, tz)}`
                : "Sessions TBD"}
              </span>
              {e.certificateIssuedAt && (
                <span className="inline-flex items-center rounded-full bg-accent-teal/10 text-accent-teal px-2 py-0.5 text-[11px] font-semibold">
                  Certificate earned
                </span>
              )}
            </div>
            {e.status === "Approved" && e.attendance.total > 0 && (
              <p className="text-xs text-muted-foreground mt-1">
                Attended {e.attendance.present}
                {e.attendance.excused > 0 ? ` (+${e.attendance.excused} excused)` : ""} of{" "}
                {e.attendance.total} session{e.attendance.total === 1 ? "" : "s"}
              </p>
            )}
            {e.feedback && (
              <p className="text-sm text-foreground mt-2">
                <span className="text-xs font-semibold text-muted-foreground block inline-flex items-center gap-1">
                  Instructor feedback (shared with the student)
                  <InfoTip content="This note is visible to the student on their course page. It's the instructor's exit feedback for the student." />
                </span>
                {e.feedback}
              </p>
            )}
            {e.internalNote && (
              <p className="text-sm text-foreground mt-2 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                <span className="text-xs font-semibold text-amber-800 block inline-flex items-center gap-1">
                  Internal instructor note — never shown to the student
                  <InfoTip content="This note is only visible to instructors and Core members. It's separate from the shared feedback and used for hiring context." />
                </span>
                {e.internalNote}
              </p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
