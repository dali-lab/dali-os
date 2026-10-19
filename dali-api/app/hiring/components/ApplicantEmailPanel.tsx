import { ArrowDownLeft, CornerUpLeft, Mail } from "lucide-react";
import { formatDateShort } from "~/lib/display";
import { useUserTimeZone } from "~/hooks/useUserTimeZone";
import { SharedInboxPanel } from "~/email/components/SharedInboxPanel";
import type { EmailEngagement, EngagementSummary } from "~/hiring/lib/email-engagement.server";
import { Tooltip } from "~/components/ui/floating";

export function ApplicantEmailPanel({
  engagement,
  blinded,
  applicationId,
  defaultOpen,
}: {
  engagement: EmailEngagement | null;
  blinded: boolean;
  applicationId: string;
  defaultOpen?: boolean;
}) {
  if (!engagement || engagement.totals.fromThem === 0) return null;

  return (
    <SharedInboxPanel
      title="Email with applications@"
      threads={engagement.threads}
      threadUrl={(indexId) => `/api/hiring/applications/${applicationId}/email-thread/${indexId}`}
      emptyLabel={blinded ? "Subject hidden during blind review" : "(no subject)"}
      defaultOpen={defaultOpen}
      subtitle={engagementLine(engagement.totals)}
      rowIcon={(t) =>
        t.startedByThem ? (
          <ArrowDownLeft className="h-4 w-4 shrink-0 text-os-grey" aria-label="They started this thread" />
        ) : (
          <CornerUpLeft className="h-4 w-4 shrink-0 text-os-grey" aria-label="They replied to us" />
        )
      }
      rowDetail={(t) => `${t.fromThem} of ${t.messages} from them`}
    />
  );
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function engagementLine(summary: EngagementSummary): string {
  const sent = `${plural(summary.fromThem, "email")} from them`;
  return summary.threadsStarted ? `${sent} · started ${plural(summary.threadsStarted, "thread")}` : sent;
}

// The list-row form of the panel above.
export function ApplicantEngagementChip({ summary }: { summary: EngagementSummary | undefined }) {
  const tz = useUserTimeZone();
  if (!summary) return null;
  const last = summary.lastFromThemAt ? `. Last on ${formatDateShort(summary.lastFromThemAt, tz)}` : "";
  return (
    <Tooltip content={`${engagementLine(summary)}${last}`}>
      <span
        aria-label={`${engagementLine(summary)}${last}`}
        className="inline-flex shrink-0 items-center gap-1 rounded-full bg-os-container px-2 py-0.5 text-xs font-medium text-foreground"
      >
        <Mail className="h-3 w-3" aria-hidden />
        {summary.fromThem}
      </span>
    </Tooltip>
  );
}
