import { useState } from "react";
import { ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { formatDateShort } from "~/lib/display";
import { useUserTimeZone } from "~/hooks/useUserTimeZone";
import { ApplicantEmailThreadModal } from "~/hiring/components/ApplicantEmailThreadModal";
import type { EmailEngagement } from "~/hiring/lib/email-engagement.server";

// "Email with applications@" panel on the hiring application views: this
// applicant's mail history with the shared applications@ inbox, grouped into
// threads. Same card chrome as EducationEngagementPanel / PriorApplicationsPanel.
// Subjects and the thread pointer are already stripped server-side while the
// viewer is blinded — this component just renders whatever it's handed.

export function ApplicantEmailPanel({
  engagement,
  blinded,
  applicationId,
}: {
  engagement: EmailEngagement | null;
  blinded: boolean;
  applicationId: string;
}) {
  const tz = useUserTimeZone();
  const [openIndexId, setOpenIndexId] = useState<string | null>(null);
  if (!engagement || engagement.totals.inbound + engagement.totals.outbound === 0) return null;

  const { totals, threads } = engagement;

  return (
    <section className="bg-card border border-border rounded-lg">
      <div className="px-6 py-4 border-b border-border">
        <h2 className="font-heading font-bold text-foreground">Email with applications@</h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          {totals.inbound} received · {totals.outbound} sent
          {totals.firstAt && totals.lastAt
            ? ` · first ${formatDateShort(totals.firstAt, tz)} · last ${formatDateShort(totals.lastAt, tz)}`
            : ""}
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
              <span className="text-sm font-medium text-foreground truncate">
                {t.subject || (blinded ? "Subject hidden during blind review" : "(no subject)")}
              </span>
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
        <ApplicantEmailThreadModal
          applicationId={applicationId}
          indexId={openIndexId}
          onClose={() => setOpenIndexId(null)}
        />
      )}
    </section>
  );
}
