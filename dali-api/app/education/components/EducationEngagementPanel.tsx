import { formatDateShort } from "~/lib/display";
import { useUserTimeZone } from "~/hooks/useUserTimeZone";
import { TypeBadge, MyStatusChip } from "./OfferingCard";
import { InfoTip } from "~/components/ui/floating";
import { ApplicantPanel, PANEL_ROW } from "~/hiring/components/ApplicantPanel";
import { Pill } from "~/hiring/components/cycle-setup/SetupCard";
import type { OfferingType } from "~/education/lib/offering-type";
import { attendanceCopy, type AttendanceSummary } from "~/education/lib/session-time";

// "Past DALI education" panel on the hiring application views: what this
// applicant attended, how consistently they showed up, and what instructors
// said. Rendered only behind reviewer access + confidentiality gates —
// `internalNote` is hiring-only and must never reach a student surface.

export type EngagementRow = {
  offeringId: string;
  title: string;
  type: OfferingType;
  startsAt: string | Date | null;
  endsAt: string | Date | null;
  status: string;
  attendance: AttendanceSummary;
  certificateIssuedAt: string | Date | null;
  feedback: string | null;
  internalNote: string | null;
};

export function EducationEngagementPanel({
  entries,
  defaultOpen,
}: {
  entries: EngagementRow[];
  defaultOpen?: boolean;
}) {
  const tz = useUserTimeZone();
  if (entries.length === 0) return null;
  return (
    <ApplicantPanel title="Past DALI education" defaultOpen={defaultOpen}>
        {entries.map((e) => (
          <li key={e.offeringId} className={PANEL_ROW}>
            <div className="flex flex-wrap items-center gap-2">
              <TypeBadge type={e.type} />
              <span className="text-sm font-semibold text-foreground">{e.title}</span>
              <MyStatusChip status={e.status} />
              <span className="text-xs text-os-grey">
                {e.startsAt && e.endsAt
                ? `${formatDateShort(e.startsAt, tz)} – ${formatDateShort(e.endsAt, tz)}`
                : "Sessions TBD"}
              </span>
              {e.certificateIssuedAt && (
                <Pill outline dot="success">Certificate earned</Pill>
              )}
            </div>
            {e.status === "Approved" && e.attendance.total > 0 && (
              <p className="text-xs text-os-grey mt-1">
                {attendanceCopy(e.attendance, "sentence")}
              </p>
            )}
            {e.feedback && (
              <p className="text-sm text-foreground mt-2">
                <span className="text-xs font-semibold text-os-grey flex items-center gap-1">
                  Instructor feedback (shared with the student)
                  <InfoTip content="This note is visible to the student on their course page. It's the instructor's exit feedback for the student." />
                </span>
                {e.feedback}
              </p>
            )}
            {e.internalNote && (
              <p className="text-sm text-foreground mt-2 bg-os-amber/10 rounded-os-item px-3 py-2">
                <span className="text-xs font-semibold text-os-amber flex items-center gap-1">
                  Internal instructor note. Never shown to the student
                  <InfoTip content="This note is only visible to instructors and Core members. It's separate from the shared feedback and used for hiring context." />
                </span>
                {e.internalNote}
              </p>
            )}
          </li>
        ))}
    </ApplicantPanel>
  );
}
