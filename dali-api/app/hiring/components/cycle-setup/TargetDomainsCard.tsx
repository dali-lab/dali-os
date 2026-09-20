import { useFetcher } from "react-router";
import { Checkbox } from "~/components/ui/Checkbox";
import { Tooltip } from "~/components/ui/floating";
import { cn } from "~/lib/cn";
import { SetupCard } from "./SetupCard";
import { ChallengeLine, NotReadyIcon, type DomainChallenge } from "./ChallengeLine";

// Domains an Interns cycle hires into. Unlike Students cycles there's no domain
// lead setup per domain (no challenge, no per-domain rubric), so the hiring lead
// picks the set and marks each one ready here.
export function TargetDomainsCard({
  cycleDomains,
  eligibleDomains,
  cycleStatus,
  challengeFor,
}: {
  cycleDomains: { domainId: string; isReady: boolean; domain: { displayName: string } }[];
  eligibleDomains: { id: string; displayName: string }[];
  cycleStatus: string;
  /** A domain's challenges; null when the cycle has none. */
  challengeFor: (domainId: string) => DomainChallenge | null;
}) {
  const fetcher = useFetcher<{ error?: string }>();
  const readyFetcher = useFetcher();
  const locked = cycleStatus !== "Draft";
  const selectedIds = new Set(cycleDomains.map((d) => d.domainId));

  function toggle(id: string) {
    const next = selectedIds.has(id)
      ? [...selectedIds].filter((d) => d !== id)
      : [...selectedIds, id];
    fetcher.submit({ intent: "set-target-domains", domainIds: JSON.stringify(next) }, { method: "post" });
  }

  return (
    <SetupCard title="Target domains" description="Domains interns can apply to. They share the general rubric and one reviewer pool.">
      <Tooltip content={locked ? "Domains lock once the cycle opens." : null} variant="rich">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {eligibleDomains.map((d) => {
            const checked = selectedIds.has(d.id);
            return (
              <Checkbox
                key={d.id}
                label={d.displayName}
                checked={checked}
                disabled={locked}
                onChange={() => toggle(d.id)}
                className={cn(
                  "rounded-os-item border px-3 py-2 text-sm",
                  checked ? "border-os-accent bg-os-accent/15" : "border-os-container",
                  locked ? "opacity-50" : "cursor-pointer",
                )}
              />
            );
          })}
        </div>
      </Tooltip>
      {fetcher.data?.error && <p className="text-xs text-red-700">{fetcher.data.error}</p>}
      {cycleDomains.length > 0 && (
        <ul className="flex flex-col gap-2">
          {cycleDomains.map((d) => (
            <li key={d.domainId} className="flex flex-wrap items-center justify-between gap-3 rounded-os-item bg-os-well px-4 py-3">
              <span className="flex flex-col gap-1">
                <span className="flex items-center gap-2 text-sm text-foreground">
                  {!d.isReady && <NotReadyIcon />}
                  {d.domain.displayName}
                </span>
                {challengeFor(d.domainId) && (
                  <ChallengeLine domainId={d.domainId} challenge={challengeFor(d.domainId)!} editable={!locked} />
                )}
              </span>
              <Checkbox
                label="Ready"
                className="text-sm"
                checked={d.isReady}
                disabled={locked}
                onChange={(e) =>
                  readyFetcher.submit(
                    {
                      intent: e.target.checked ? "hl-force-mark-ready" : "hl-force-unmark-ready",
                      domainId: d.domainId,
                      confirm: "true",
                    },
                    { method: "post" },
                  )
                }
              />
            </li>
          ))}
        </ul>
      )}
    </SetupCard>
  );
}
