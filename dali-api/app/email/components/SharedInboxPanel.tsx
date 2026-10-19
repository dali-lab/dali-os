import { useState, type ReactNode } from "react";
import { ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { formatDateShort } from "~/lib/display";
import { useUserTimeZone } from "~/hooks/useUserTimeZone";
import { SharedInboxThreadModal } from "~/email/components/SharedInboxThreadModal";
import { ApplicantPanel, PANEL_ROW } from "~/hiring/components/ApplicantPanel";

// Generalized from app/hiring/components/ApplicantEmailPanel.tsx: a shared
// inbox's mail history with one record, grouped into threads, in the same
// ApplicantPanel card as the rest of the applicant page. Callers
// (hiring's ApplicantEmailPanel, the Partner CRM's PartnerEmailPanel) supply
// already-resolved threads (any blinding happens server-side, before this
// renders) plus the fallback label for a thread with no visible subject.

export type SharedInboxThread = {
  indexId: string | null;
  subject: string | null;
  firstAt: string;
  lastAt: string;
  inbound: number;
  outbound: number;
};

export function SharedInboxPanel<T extends SharedInboxThread>({
  title,
  threads,
  threadUrl,
  emptyLabel,
  defaultOpen,
  subtitle,
  rowIcon,
  rowDetail,
}: {
  title: string;
  threads: T[];
  threadUrl: (indexId: string) => string;
  emptyLabel: string;
  defaultOpen?: boolean;
  /** Replaces the default "N received · N sent" line. */
  subtitle?: string;
  /** Replaces the default arrow, which points the way most of the thread's mail went. */
  rowIcon?: (thread: T) => ReactNode;
  /** Replaces the default "N messages" after the date range. */
  rowDetail?: (thread: T) => string;
}) {
  const tz = useUserTimeZone();
  const [openIndexId, setOpenIndexId] = useState<string | null>(null);
  if (threads.length === 0) return null;

  const totals = threads.reduce(
    (acc, t) => ({ inbound: acc.inbound + t.inbound, outbound: acc.outbound + t.outbound }),
    { inbound: 0, outbound: 0 },
  );

  return (
    <ApplicantPanel
      title={title}
      defaultOpen={defaultOpen}
      subtitle={subtitle ?? `${totals.inbound} received · ${totals.outbound} sent`}
    >
      {threads.map((t, i) => {
        const dominant = t.inbound >= t.outbound ? "inbound" : "outbound";
        const count = t.inbound + t.outbound;
        const content = (
          <>
            {rowIcon ? (
              rowIcon(t)
            ) : dominant === "inbound" ? (
              <ArrowDownLeft className="h-4 w-4 shrink-0 text-os-grey" />
            ) : (
              <ArrowUpRight className="h-4 w-4 shrink-0 text-os-grey" />
            )}
            <span className="text-sm font-medium text-foreground truncate">{t.subject || emptyLabel}</span>
            <span className="ml-auto shrink-0 text-xs text-os-grey">
              {formatDateShort(t.firstAt, tz)}
              {t.firstAt !== t.lastAt ? ` – ${formatDateShort(t.lastAt, tz)}` : ""} ·{" "}
              {rowDetail ? rowDetail(t) : `${count} message${count === 1 ? "" : "s"}`}
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
        <SharedInboxThreadModal url={threadUrl(openIndexId)} onClose={() => setOpenIndexId(null)} />
      )}
    </ApplicantPanel>
  );
}
