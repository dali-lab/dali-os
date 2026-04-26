import { useState } from "react";

export function DelibsSection({ cycleId, domainId, sessions, initialCount, finalCount }: {
  cycleId: string;
  domainId: string;
  sessions: any[];
  initialCount: number;
  finalCount: number;
}) {
  const [loading, setLoading] = useState<string | null>(null);

  const initialSession = sessions.find((s: any) => s.type === "Initial");
  const finalSession = sessions.find((s: any) => s.type === "Final");

  async function openDelibs(type: "Initial" | "Final") {
    setLoading(type);
    const res = await fetch(`/api/cycles/${cycleId}/delibs`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ domainId, type }),
    });
    if (res.ok) {
      const session = await res.json();
      window.location.href = `/domain-lead/delibs/${session.id}`;
    }
    setLoading(null);
  }

  function renderButton(type: "Initial" | "Final", session: any) {
    const count = type === "Initial" ? initialCount : finalCount;
    const countBadge = ` (${count} applicant${count !== 1 ? "s" : ""})`;

    if (session?.status === "Active") {
      return (
        <a
          href={`/domain-lead/delibs/${session.id}`}
          className="px-4 py-2 text-sm font-medium rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition"
        >
          Continue {type} Delibs{countBadge}
        </a>
      );
    }
    if (session?.status === "Closed") {
      return (
        <button
          onClick={() => openDelibs(type)}
          disabled={loading === type || count === 0}
          className="px-4 py-2 text-sm font-medium rounded-lg bg-yellow-600 hover:bg-yellow-700 text-white transition disabled:opacity-50"
        >
          {loading === type ? "Reopening..." : `Reopen ${type} Delibs${countBadge}`}
        </button>
      );
    }
    return (
      <button
        onClick={() => openDelibs(type)}
        disabled={loading === type || count === 0}
        className="px-4 py-2 text-sm font-medium rounded-lg bg-green-600 hover:bg-green-700 text-white transition disabled:opacity-50"
      >
        {loading === type ? "Starting..." : `Start ${type} Delibs${countBadge}`}
      </button>
    );
  }

  return (
    <div className="bg-card border border-border rounded-lg overflow-hidden">
      <div className="px-6 py-4 border-b border-border bg-muted/50">
        <h3 className="font-semibold text-foreground">Deliberations</h3>
      </div>
      <div className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-foreground">Initial Delibs</p>
            <p className="text-xs text-muted-foreground">Review applications and decide who advances to interviews</p>
          </div>
          {renderButton("Initial", initialSession)}
        </div>
        <div className="border-t border-border pt-3 flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-foreground">Final Delibs</p>
            <p className="text-xs text-muted-foreground">Post-interview decisions: accept, waitlist, or reject</p>
          </div>
          {renderButton("Final", finalSession)}
        </div>
      </div>
    </div>
  );
}
