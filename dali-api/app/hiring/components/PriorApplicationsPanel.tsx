import { Link } from "react-router";
import { formatDateShort } from "~/lib/display";
import { useUserTimeZone } from "~/hooks/useUserTimeZone";
import { HiringStatusPill } from "./HiringStatusPill";
import type { PriorApplicationRow } from "~/hiring/lib/prior-applications.server";

// "Prior applications" panel on the hiring application views: this
// applicant's other submitted cycles, so a reviewer/lead doesn't have to go
// digging for hiring history. Sits beside EducationEngagementPanel, same card
// chrome. Outcomes are already nulled server-side when outcomesHidden is set
// (blind review) — this component never has the real statuses to leak.

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
}: {
  entries: PriorApplicationRow[];
  outcomesHidden: boolean;
  hrefFor: (entry: PriorApplicationRow, domainId: string) => string | null;
}) {
  const tz = useUserTimeZone();
  if (entries.length === 0) return null;

  return (
    <section className="bg-card border border-border rounded-lg">
      <div className="px-6 py-4 border-b border-border">
        <h2 className="font-heading font-bold text-foreground">Prior applications</h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          Applied {entries.length === 1 ? "once" : `${entries.length} times`} before
        </p>
      </div>
      <ul className="divide-y divide-border">
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
            <li key={entry.id} className="px-6 py-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-foreground">{entry.cycleName}</span>
                {typeLabel && (
                  <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
                    {typeLabel}
                  </span>
                )}
                <span className="text-xs text-muted-foreground">
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
                      <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-foreground">
                        {domain.domainName}
                      </span>
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
                      className="text-xs font-semibold text-accent-coral hover:text-accent-coral/80"
                    >
                      View submission{links.length > 1 ? ` · ${domainNames.join(", ")}` : ""}
                    </Link>
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {outcomesHidden && (
        <p className="px-6 py-3 text-xs text-muted-foreground border-t border-border">
          Outcomes from earlier cycles are hidden during blind review.
        </p>
      )}
    </section>
  );
}
