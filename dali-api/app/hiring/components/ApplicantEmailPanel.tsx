import { useState } from "react";
import { ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { formatDateShort } from "~/lib/display";
import { useUserTimeZone } from "~/hooks/useUserTimeZone";
import { ApplicantEmailThreadModal } from "~/hiring/components/ApplicantEmailThreadModal";
import type { EmailEngagement } from "~/hiring/lib/email-engagement.server";
import { ApplicantPanel, PANEL_ROW } from "~/hiring/components/ApplicantPanel";

// Subjects and the thread pointer are already stripped server-side while the
// viewer is blinded, so this component renders whatever it's handed.

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
  if (!engagement || engagement.totals.inbound + engagement.totals.outbound === 0) return null;

  const { totals, threads } = engagement;

  return (
    <ApplicantPanel
      title="Email with applications@"
      defaultOpen={defaultOpen}
      subtitle={`${totals.inbound} received · ${totals.outbound} sent`}
    >
        {threads.map((t, i) => {
          const dominant = t.inbound >= t.outbound ? "inbound" : "outbound";
          const count = t.inbound + t.outbound;
          const content = (
            <>
              {dominant === "inbound" ? (
                <ArrowDownLeft className="h-4 w-4 shrink-0 text-os-grey" />
              ) : (
                <ArrowUpRight className="h-4 w-4 shrink-0 text-os-grey" />
              )}
              <span className="text-sm font-medium text-foreground truncate">
                {t.subject || (blinded ? "Subject hidden during blind review" : "(no subject)")}
              </span>
              <span className="ml-auto shrink-0 text-xs text-os-grey">
                {formatDateShort(t.firstAt, tz)}
                {t.firstAt !== t.lastAt ? ` – ${formatDateShort(t.lastAt, tz)}` : ""} · {count} message
                {count === 1 ? "" : "s"}
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
