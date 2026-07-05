import { useState } from "react";
import { useRevalidator } from "react-router";
import { Button } from "~/components/ui/Button";
import { StatusPill } from "./OfferingCard";
import { EducationAnswerDisplay } from "./EducationAnswerDisplay";

interface Row {
  id: string;
  applicant: {
    id: string;
    firstName: string | null;
    lastName: string | null;
    dartmouthEmail: string | null;
    netId: string | null;
  };
  status: "Submitted" | "Approved" | "Waitlisted" | "Rejected" | "Withdrawn";
  submittedAt: string;
  answers: { question: { prompt: string; position: number; type: "Text" | "Url" | "File" }; content: string }[];
}

export function ApplicationsTable({ rows }: { rows: Row[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const { revalidate } = useRevalidator();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  async function decide(applicationId: string, status: string) {
    setPending(applicationId);
    setError(null);
    try {
      const res = await fetch(`/api/education/applications/${applicationId}/decision`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? "Failed to update");
      } else {
        revalidate();
      }
    } finally {
      setPending(null);
    }
  }

  async function bulkDecide(status: string) {
    if (selected.size === 0) return;
    if (!confirm(`Apply "${status}" to ${selected.size} application${selected.size === 1 ? "" : "s"}?`)) return;
    setBulkBusy(true);
    setError(null);
    const res = await fetch("/api/education/applications/decisions/bulk", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: Array.from(selected), status }),
    });
    setBulkBusy(false);
    if (res.ok) {
      setSelected(new Set());
      revalidate();
    } else {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Bulk update failed");
    }
  }

  function toggleAll() {
    if (selected.size === rows.length) setSelected(new Set());
    else setSelected(new Set(rows.map((r) => r.id)));
  }
  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">No applications yet.</p>;
  }

  return (
    <div className="space-y-3">
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      )}
      {selected.size > 0 && (
        <div className="sticky top-2 z-10 flex items-center gap-3 rounded-lg border border-accent-coral/40 bg-accent-coral/10 px-3 py-2 text-sm">
          <span className="text-dark-blue font-semibold">{selected.size} selected</span>
          <button onClick={() => bulkDecide("Approved")} disabled={bulkBusy} className="text-xs px-3 py-1 rounded-full bg-green-100 text-green-700 hover:bg-green-200 transition">
            Approve all
          </button>
          <button onClick={() => bulkDecide("Waitlisted")} disabled={bulkBusy} className="text-xs px-3 py-1 rounded-full bg-yellow-100 text-yellow-800 hover:bg-yellow-200 transition">
            Waitlist all
          </button>
          <button onClick={() => bulkDecide("Rejected")} disabled={bulkBusy} className="text-xs px-3 py-1 rounded-full bg-red-100 text-red-700 hover:bg-red-200 transition">
            Reject all
          </button>
          <button onClick={() => setSelected(new Set())} className="ml-auto text-xs text-muted-foreground hover:underline">
            Clear
          </button>
        </div>
      )}
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground border-b border-border">
            <th className="py-2 pr-3 w-8">
              <input
                type="checkbox"
                checked={selected.size === rows.length && rows.length > 0}
                onChange={toggleAll}
                aria-label="Select all"
              />
            </th>
            <th className="py-2 pr-3">Applicant</th>
            <th className="py-2 pr-3">Submitted</th>
            <th className="py-2 pr-3">Status</th>
            <th className="py-2 pr-3">Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const isOpen = openId === row.id;
            const name = `${row.applicant.firstName ?? ""} ${row.applicant.lastName ?? ""}`.trim() || row.applicant.netId || "Unknown";
            const isPending = pending === row.id;
            return (
              <>
                <tr key={row.id} className="border-b border-border/60">
                  <td className="py-3 pr-3">
                    <input
                      type="checkbox"
                      checked={selected.has(row.id)}
                      onChange={() => toggleOne(row.id)}
                      aria-label={`Select ${name}`}
                    />
                  </td>
                  <td className="py-3 pr-3">
                    <div className="font-medium text-dark-blue">{name}</div>
                    <div className="text-xs text-muted-foreground">
                      {row.applicant.dartmouthEmail ?? `${row.applicant.netId}@dartmouth.edu`}
                    </div>
                  </td>
                  <td className="py-3 pr-3 text-xs text-muted-foreground">
                    {new Date(row.submittedAt).toLocaleDateString()}
                  </td>
                  <td className="py-3 pr-3">
                    <StatusPill status={row.status} />
                  </td>
                  <td className="py-3 pr-3">
                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={() => setOpenId(isOpen ? null : row.id)}
                        className="text-xs text-accent-coral hover:underline"
                      >
                        {isOpen ? "Hide" : "View"} answers
                      </button>
                      {row.status !== "Approved" && (
                        <Button size="sm" variant="primary" disabled={isPending} onClick={() => decide(row.id, "Approved")}>
                          Approve
                        </Button>
                      )}
                      {row.status !== "Waitlisted" && row.status !== "Withdrawn" && (
                        <Button size="sm" variant="secondary" disabled={isPending} onClick={() => decide(row.id, "Waitlisted")}>
                          Waitlist
                        </Button>
                      )}
                      {row.status !== "Rejected" && row.status !== "Withdrawn" && (
                        <Button size="sm" variant="destructive" disabled={isPending} onClick={() => decide(row.id, "Rejected")}>
                          Reject
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
                {isOpen && (
                  <tr key={`${row.id}-answers`} className="border-b border-border/60 bg-brand-tint/30">
                    <td colSpan={5} className="py-3 px-3">
                      {row.answers.length === 0 ? (
                        <p className="text-xs text-muted-foreground italic">No questions on this offering.</p>
                      ) : (
                        <dl className="space-y-2">
                          {row.answers
                            .slice()
                            .sort((a, b) => a.question.position - b.question.position)
                            .map((a, idx) => (
                              <div key={idx}>
                                <dt className="text-xs font-semibold text-dark-blue">{a.question.prompt}</dt>
                                <dd>
                                  <EducationAnswerDisplay question={a.question} answer={a.content} />
                                </dd>
                              </div>
                            ))}
                        </dl>
                      )}
                    </td>
                  </tr>
                )}
              </>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
