import { formatDateShort } from "~/lib/display";
import { useUserTimeZone } from "~/hooks/useUserTimeZone";
import { TypeBadge, MyStatusChip } from "./OfferingCard";

// "Past DALI education" panel on the hiring application views: what this
// applicant attended, how consistently they showed up, and what instructors
// said. Rendered only behind reviewer access + confidentiality gates —
// `internalNote` is hiring-only and must never reach a student surface.

export type EngagementRow = {
  offeringId: string;
  title: string;
  type: "Miniseries" | "Workshop";
  startsAt: string | Date;
  endsAt: string | Date;
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
                {formatDateShort(e.startsAt, tz)} – {formatDateShort(e.endsAt, tz)}
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
                <span className="text-xs font-semibold text-muted-foreground block">
                  Instructor feedback (shared with the student)
                </span>
                {e.feedback}
              </p>
            )}
            {e.internalNote && (
              <p className="text-sm text-foreground mt-2 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                <span className="text-xs font-semibold text-amber-800 block">
                  Internal instructor note — never shown to the student
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
