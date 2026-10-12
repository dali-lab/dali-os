import { Video } from "lucide-react";
import type {
  PartnerMeetingRequestSummary,
  PartnerMeetingSummary,
} from "~/partners/lib/partner-meetings.server";

const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

// Upcoming real meetings, pending requests, and declined requests — the
// portal's read of specs/partner-crm.md §6. Renders nothing when there's
// nothing to show; the "Request a meeting" button lives next to it on the
// page, not inside this section.
export function PartnerMeetingsSection({
  meetings,
  pendingRequests,
  declinedRequests,
  onRequestAnother,
}: {
  meetings: PartnerMeetingSummary[];
  pendingRequests: PartnerMeetingRequestSummary[];
  declinedRequests: PartnerMeetingRequestSummary[];
  onRequestAnother?: () => void;
}) {
  if (meetings.length === 0 && pendingRequests.length === 0 && declinedRequests.length === 0) {
    return null;
  }

  return (
    <section id="meetings" className="scroll-mt-24">
      <h2 className="mb-3 font-heading text-lg font-semibold text-dark-blue">Meetings</h2>
      <div className="bg-card border border-border rounded-2xl divide-y divide-border">
        {meetings.map((m) => (
          <div key={m.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
            <div className="min-w-0">
              <div className="font-medium text-foreground truncate">{m.title}</div>
              <div className="text-xs text-muted-foreground">{fmtDateTime(m.startTime)}</div>
            </div>
            {m.meetingUrl && (
              <a
                href={m.meetingUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex shrink-0 items-center gap-1.5 text-xs font-medium text-accent-teal hover:underline"
              >
                <Video className="h-3.5 w-3.5" /> Join call
              </a>
            )}
          </div>
        ))}
        {pendingRequests.map((r) => (
          <div key={r.id} className="px-4 py-3 text-sm text-muted-foreground">
            Requested for {fmtDateTime(r.startTime)}, waiting on the team
          </div>
        ))}
        {declinedRequests.map((r) => (
          <div key={r.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
            <div className="min-w-0">
              <div className="text-foreground">Request for {fmtDateTime(r.startTime)} declined</div>
              {r.responseNote && (
                <div className="mt-0.5 text-xs text-muted-foreground">{r.responseNote}</div>
              )}
            </div>
            {onRequestAnother && (
              <button
                type="button"
                onClick={onRequestAnother}
                className="shrink-0 text-xs font-medium text-accent-teal hover:underline"
              >
                Request another time
              </button>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
