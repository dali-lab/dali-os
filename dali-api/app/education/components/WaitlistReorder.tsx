import { useState } from "react";
import { useRevalidator } from "react-router";
import { Button } from "~/components/ui/Button";

interface Row {
  id: string;
  applicant: { firstName: string | null; lastName: string | null; netId: string | null };
  submittedAt: string;
}

export function WaitlistReorder({ offeringId, rows }: { offeringId: string; rows: Row[] }) {
  const { revalidate } = useRevalidator();
  const [order, setOrder] = useState(rows.map((r) => r.id));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = order.join(",") !== rows.map((r) => r.id).join(",");

  function move(i: number, delta: -1 | 1) {
    const j = i + delta;
    if (j < 0 || j >= order.length) return;
    const next = [...order];
    [next[i], next[j]] = [next[j], next[i]];
    setOrder(next);
  }

  async function save() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/education/offerings/${offeringId}/waitlist/reorder`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: order }),
    });
    setBusy(false);
    if (res.ok) {
      revalidate();
    } else {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Save failed");
    }
  }

  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">No one on the waitlist.</p>;
  }

  const byId = new Map(rows.map((r) => [r.id, r]));

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        When a seat opens, the next person in this order is auto-promoted. Drag-equivalent reorder via the up/down arrows.
      </p>
      <ol className="space-y-2">
        {order.map((id, i) => {
          const r = byId.get(id);
          if (!r) return null;
          const name = `${r.applicant.firstName ?? ""} ${r.applicant.lastName ?? ""}`.trim() || r.applicant.netId || "Applicant";
          return (
            <li key={id} className="flex items-center gap-3 rounded-lg border border-border bg-card p-3 text-sm">
              <span className="text-xs font-mono text-muted-foreground w-6">{i + 1}.</span>
              <span className="flex-1 text-dark-blue">{name}</span>
              <span className="text-xs text-muted-foreground">
                Applied {new Date(r.submittedAt).toLocaleDateString()}
              </span>
              <button
                onClick={() => move(i, -1)}
                disabled={i === 0}
                aria-label="Move up"
                className="text-xs text-muted-foreground hover:text-dark-blue disabled:opacity-30 px-2"
              >
                ↑
              </button>
              <button
                onClick={() => move(i, 1)}
                disabled={i === order.length - 1}
                aria-label="Move down"
                className="text-xs text-muted-foreground hover:text-dark-blue disabled:opacity-30 px-2"
              >
                ↓
              </button>
            </li>
          );
        })}
      </ol>
      {error && <div className="text-sm text-red-700">{error}</div>}
      <div className="flex items-center gap-3">
        <Button variant="primary" size="sm" disabled={!dirty || busy} onClick={save}>
          {busy ? "Saving..." : "Save order"}
        </Button>
        {!dirty && <span className="text-xs text-muted-foreground">No changes</span>}
      </div>
    </div>
  );
}
