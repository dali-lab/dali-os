import { useState } from "react";
import { ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { formatDateShort } from "~/lib/display";
import { useUserTimeZone } from "~/hooks/useUserTimeZone";
import { SharedInboxThreadModal } from "~/email/components/SharedInboxThreadModal";

// Generalized from app/hiring/components/ApplicantEmailPanel.tsx: a shared
// inbox's mail history with one record, grouped into threads. Same card
// chrome as EducationEngagementPanel / PriorApplicationsPanel. Callers
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

export function SharedInboxPanel({
  title,
  threads,
  threadUrl,
  emptyLabel,
}: {
  title: string;
  threads: SharedInboxThread[];
  threadUrl: (indexId: string) => string;
  emptyLabel: string;
}) {
  const tz = useUserTimeZone();
  const [openIndexId, setOpenIndexId] = useState<string | null>(null);
  if (threads.length === 0) return null;

  const totals = threads.reduce(
    (acc, t) => ({ inbound: acc.inbound + t.inbound, outbound: acc.outbound + t.outbound }),
    { inbound: 0, outbound: 0 },
  );
  const firstAt = threads.reduce((min, t) => (t.firstAt < min ? t.firstAt : min), threads[0].firstAt);
  const lastAt = threads.reduce((max, t) => (t.lastAt > max ? t.lastAt : max), threads[0].lastAt);

  return (
    <section className="bg-card border border-border rounded-lg">
      <div className="px-6 py-4 border-b border-border">
        <h2 className="font-heading font-bold text-foreground">{title}</h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          {totals.inbound} received · {totals.outbound} sent · first {formatDateShort(firstAt, tz)} · last{" "}
          {formatDateShort(lastAt, tz)}
        </p>
      </div>
      <ul className="divide-y divide-border">
        {threads.map((t, i) => {
          const dominant = t.inbound >= t.outbound ? "inbound" : "outbound";
          const count = t.inbound + t.outbound;
          const content = (
            <>
              {dominant === "inbound" ? (
                <ArrowDownLeft className="h-4 w-4 shrink-0 text-muted-foreground" />
              ) : (
                <ArrowUpRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              )}
              <span className="text-sm font-medium text-foreground truncate">{t.subject || emptyLabel}</span>
              <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                {formatDateShort(t.firstAt, tz)}
                {t.firstAt !== t.lastAt ? ` – ${formatDateShort(t.lastAt, tz)}` : ""} · {count} message
                {count === 1 ? "" : "s"}
              </span>
            </>
          );
          const key = t.indexId ?? `${i}-${t.firstAt}`;
          return (
            <li key={key} className="px-6 py-3">
              {t.indexId ? (
                <button
                  type="button"
                  onClick={() => setOpenIndexId(t.indexId)}
                  className="flex w-full items-center gap-2 text-left hover:text-foreground"
                >
                  {content}
                </button>
              ) : (
                <div className="flex items-center gap-2">{content}</div>
              )}
            </li>
          );
        })}
      </ul>
      {openIndexId && (
        <SharedInboxThreadModal url={threadUrl(openIndexId)} onClose={() => setOpenIndexId(null)} />
      )}
    </section>
  );
}
