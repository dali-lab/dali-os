import { useState } from "react";
import { ArrowDownLeft, CornerUpLeft, Mail } from "lucide-react";
import { formatDateShort } from "~/lib/display";
import { useUserTimeZone } from "~/hooks/useUserTimeZone";
import { ApplicantEmailThreadModal } from "~/hiring/components/ApplicantEmailThreadModal";
import type { EmailEngagement, EngagementSummary } from "~/hiring/lib/email-engagement.server";
import { Tooltip } from "~/components/ui/floating";
import { ApplicantPanel, PANEL_ROW } from "~/hiring/components/ApplicantPanel";

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
  const tz = useUserTimeZone();
  const [openIndexId, setOpenIndexId] = useState<string | null>(null);
  if (!engagement || engagement.totals.fromThem === 0) return null;

  const { totals, threads } = engagement;

  return (
    <ApplicantPanel
      title="Email with applications@"
      defaultOpen={defaultOpen}
      subtitle={engagementLine(totals)}
    >
        {threads.map((t, i) => {
          const content = (
            <>
              {t.startedByThem ? (
                <ArrowDownLeft className="h-4 w-4 shrink-0 text-os-grey" aria-label="They started this thread" />
              ) : (
                <CornerUpLeft className="h-4 w-4 shrink-0 text-os-grey" aria-label="They replied to us" />
              )}
              <span className="text-sm font-medium text-foreground truncate">
                {t.subject || (blinded ? "Subject hidden during blind review" : "(no subject)")}
              </span>
              <span className="ml-auto shrink-0 text-xs text-os-grey">
                {formatDateShort(t.firstAt, tz)}
                {t.firstAt !== t.lastAt ? ` – ${formatDateShort(t.lastAt, tz)}` : ""} · {t.fromThem} of{" "}
                {t.messages} from them
              </span>
            </>
          );
          const key = t.indexId ?? `${i}-${t.firstAt}`;
          return (
            <li key={key}>
              {t.indexId ? (
                <button
                  type="button"
                  onClick={() => setOpenIndexId(t.indexId)}
                  className={`${PANEL_ROW} flex w-full items-center gap-2 text-left transition-colors hover:bg-os-container`}
                >
                  {content}
                </button>
              ) : (
                <div className={`${PANEL_ROW} flex items-center gap-2`}>{content}</div>
              )}
            </li>
          );
        })}
      {openIndexId && (
        <ApplicantEmailThreadModal
          applicationId={applicationId}
          indexId={openIndexId}
          onClose={() => setOpenIndexId(null)}
        />
      )}
    </ApplicantPanel>
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
        tabIndex={0}
        className="inline-flex shrink-0 items-center gap-1 rounded-full bg-os-container px-2 py-0.5 text-xs font-medium text-foreground"
      >
        <Mail className="h-3 w-3" aria-hidden />
        {summary.fromThem}
      </span>
    </Tooltip>
  );
}
