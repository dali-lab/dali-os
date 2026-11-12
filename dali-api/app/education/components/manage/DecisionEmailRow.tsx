import { type DecisionSlotStatus } from "~/education/lib/education-emails";


// One row of the Decision emails list: what the status sends, flagged when no
// email is written yet, with Edit/Write opening the shared subject and body in
// a modal. The email is one per status for the whole lab, not per course — the
// preview renders it against this course so the words can be checked in place.
export function DecisionEmailRow({
  slot,
  email,
}: {
  slot: { status: DecisionSlotStatus; label: string; description: string };
  email: { subject: string; body: string } | null;
}) {
  // Read-only. One row per slot shared by every course, so the words live in
  // Admin -> Email with every other email rather than in each course's page.
  // What this page still owes an instructor is whether one exists, because a slot
  // with no email sends nothing (the in-app notification still fires).
  return (
    <div className="flex items-start gap-3 rounded-os-item border border-border px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{slot.label}</span>
          {email ? null : (
            <span className="text-xs text-os-amber">
              Nothing sends for this
            </span>
          )}
        </div>
        <p className="mt-0.5 text-xs text-os-grey">{slot.description}</p>
        {email ? (
          <p className="mt-1 truncate text-xs text-os-grey">Subject: {email.subject}</p>
        ) : null}
      </div>
    </div>
  );
}
