import { useState } from "react";
import type { DomainRoundSummary } from "~/hiring/lib/domain-lead-types";
import { buttonClasses } from "~/components/ui/Button";
import type { DelibsSession } from "~/hiring/components/domain-lead/table-shared";

// One row per delib round, in timeline order.
export function roundPurpose(r: DomainRoundSummary): string {
  if (r.isFinal) return "Accept, waitlist, or reject";
  if (r.leadsToInterviews) return "Decide who interviews";
  return "Decide who moves on";
}

export function DelibsSection({ cycleId, domainId, sessions, rounds }: {
  cycleId: string;
  domainId: string;
  sessions: DelibsSession[];
  rounds: DomainRoundSummary[];
}) {
  const [loading, setLoading] = useState<string | null>(null);

  async function openDelibs(roundId: string) {
    setLoading(roundId);
    const res = await fetch(`/api/hiring/cycles/${cycleId}/delibs`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ domainId, roundId }),
    });
    if (res.ok) {
      const session = await res.json();
      window.location.href = `/hiring/domain-lead/delibs/${session.id}`;
    }
    setLoading(null);
  }

  function renderButton(round: DomainRoundSummary, session: DelibsSession | undefined) {
    const count = round.count;
    const countLabel = ` (${count})`;
    if (session?.status === "Active") {
      return (
        <a href={`/hiring/domain-lead/delibs/${session.id}`} className={buttonClasses("primary", "sm")}>
          Continue{countLabel}
        </a>
      );
    }
    const reopen = session?.status === "Closed";
    return (
      <button
        type="button"
        onClick={() => openDelibs(round.id)}
        disabled={loading === round.id || count === 0}
        className={buttonClasses("secondary", "sm")}
      >
        {loading === round.id ? (reopen ? "Reopening…" : "Starting…") : `${reopen ? "Reopen" : "Start"}${countLabel}`}
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {rounds.map((round) => (
        <div key={round.id} className="flex flex-wrap items-center justify-between gap-3 rounded-os-item bg-os-well px-4 py-3">
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="text-sm font-semibold text-foreground">{round.label}</span>
            <span className="text-sm text-os-grey">{roundPurpose(round)}</span>
          </div>
          {renderButton(round, sessions.find((s) => s.roundId === round.id))}
        </div>
      ))}
    </div>
  );
}
