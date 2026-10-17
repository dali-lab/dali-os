import { Link } from "react-router";
import { formatDateShort } from "~/lib/display";
import { useUserTimeZone } from "~/hooks/useUserTimeZone";
import { HiringStatusPill } from "./HiringStatusPill";
import { ApplicantPanel, PANEL_ROW } from "./ApplicantPanel";
import { Pill } from "./cycle-setup/SetupCard";
import type { PriorApplicationRow } from "~/hiring/lib/prior-applications.server";

// Outcomes are already nulled server-side when outcomesHidden is set (blind
// review), so this component never has the real statuses to leak.

const APPLICATION_TYPE_LABEL: Record<string, string> = {
  Intern: "Intern",
  Fellowship: "Fellowship",
  Core: "Core",
  Transfer: "Transfer",
};

export function PriorApplicationsPanel({
  entries,
  outcomesHidden,
  hrefFor,
  defaultOpen,
}: {
  entries: PriorApplicationRow[];
  outcomesHidden: boolean;
  hrefFor: (entry: PriorApplicationRow, domainId: string) => string | null;
  defaultOpen?: boolean;
}) {
  const tz = useUserTimeZone();
  if (entries.length === 0) return null;

  return (
    <ApplicantPanel
      title="Prior applications"
      defaultOpen={defaultOpen}
      subtitle={`Applied ${entries.length === 1 ? "once" : `${entries.length} times`} before`}
      footer={outcomesHidden ? "Outcomes from earlier cycles are hidden during blind review." : undefined}
    >
        {entries.map((entry) => {
          const typeLabel = APPLICATION_TYPE_LABEL[entry.applicationType];
          const hrefGroups = new Map<string, string[]>();
          for (const domain of entry.domains) {
            const href = hrefFor(entry, domain.id);
            if (!href) continue;
            const names = hrefGroups.get(href) ?? [];
            names.push(domain.domainName);
            hrefGroups.set(href, names);
          }
          if (entry.domains.length === 0) {
            const href = hrefFor(entry, "");
            if (href) hrefGroups.set(href, []);
          }
          const links = [...hrefGroups.entries()];

          return (
            <li key={entry.id} className={PANEL_ROW}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-foreground">{entry.cycleName}</span>
                {typeLabel && <Pill outline>{typeLabel}</Pill>}
                <span className="text-xs text-os-grey">
                  {entry.applicationStatus === "Withdrawn"
                    ? "Withdrawn"
                    : entry.submittedAt
                      ? `Submitted ${formatDateShort(entry.submittedAt, tz)}`
                      : null}
                </span>
              </div>

              {entry.domains.length > 0 && (
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                  {entry.domains.map((domain) => (
                    <span key={domain.id} className="inline-flex items-center gap-1.5">
                      <span className="text-sm text-foreground">{domain.domainName}</span>
                      {domain.status != null && <HiringStatusPill status={domain.status} />}
                    </span>
                  ))}
                </div>
              )}

              {links.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-3">
                  {links.map(([href, domainNames]) => (
                    <Link
                      key={href}
                      to={href}
                      className="text-xs font-semibold text-os-accent hover:text-os-accent-hover"
                    >
                      View submission{links.length > 1 ? ` · ${domainNames.join(", ")}` : ""}
                    </Link>
                  ))}
                </div>
              )}
            </li>
          );
        })}
    </ApplicantPanel>
  );
}
