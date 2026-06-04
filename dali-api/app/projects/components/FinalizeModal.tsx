import { useState } from "react";
import { useRevalidator } from "react-router";
import { Modal } from "~/components/Modal";

type Automation = "assignments" | "slack" | "gmail" | "github";

type StepResult = { status: "ok" | "skipped" | "error"; message: string };

const AUTOMATIONS: {
  id: Automation;
  label: string;
  description: string;
  // `configured: false` renders disabled with a "Not configured" note. A
  // `true` automation is wired end-to-end; runtime gaps (e.g. a missing env var
  // or unset project field) are reported by the server as a per-step "skipped"
  // result rather than disabling the control here.
  configured: boolean;
}[] = [
  {
    id: "assignments",
    label: "Propagate assignments",
    description:
      "Confirm proposed staffing rows and write canonical ProjectAssignment + DomainEligibility.",
    configured: true,
  },
  {
    id: "slack",
    label: "Post roster to Slack",
    description: "Announce the confirmed roster in the staffing channel.",
    configured: true,
  },
  {
    id: "github",
    label: "Set up GitHub teams",
    description: "Create the project's GitHub team and add the confirmed roster.",
    configured: true,
  },
  {
    id: "gmail",
    label: "Create Gmail accounts",
    description:
      "Provision the project's Google Workspace account and -team group, and add the confirmed roster to the group.",
    configured: true,
  },
];

export function FinalizeModal({
  open,
  onClose,
  cycleId,
  projectId,
  projectName,
}: {
  open: boolean;
  onClose: () => void;
  cycleId: string;
  projectId: string;
  projectName: string;
}) {
  const revalidator = useRevalidator();
  const [selected, setSelected] = useState<Set<Automation>>(
    () => new Set(AUTOMATIONS.filter((a) => a.configured).map((a) => a.id)),
  );
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<Partial<Record<Automation, StepResult>> | null>(null);
  const [error, setError] = useState<string | null>(null);

  function toggle(id: Automation) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function run(ids: Automation[]) {
    if (ids.length === 0) {
      setError("Select at least one automation.");
      return;
    }
    setRunning(true);
    setError(null);
    setResults(null);
    try {
      const res = await fetch("/api/staffing/finalize", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cycleId, projectId, automations: ids }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        results?: Partial<Record<Automation, StepResult>>;
        error?: string;
      };
      if (!res.ok) {
        setError(json.error ?? `Request failed: ${res.status}`);
        return;
      }
      setResults(json.results ?? {});
      // Assignments may have changed the board's confirmed state.
      revalidator.revalidate();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setRunning(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      labelledBy="finalize-modal-title"
      containerClassName="bg-card rounded-2xl shadow-xl max-w-lg w-full p-5 sm:p-6 my-auto"
      disableEscape={running}
    >
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <h2 id="finalize-modal-title" className="font-heading text-lg font-bold text-foreground">
            Finalize {projectName}
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Run the selected automations. Safe to re-run.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          disabled={running}
          className="text-muted-foreground hover:text-foreground text-sm px-2 py-1 rounded hover:bg-muted disabled:opacity-50"
        >
          Close
        </button>
      </div>

      {error && (
        <div className="bg-destructive/10 border border-destructive/30 text-destructive text-sm rounded-md px-3 py-2 mb-3">
          {error}
        </div>
      )}

      <ul className="flex flex-col gap-2">
        {AUTOMATIONS.map((a) => {
          const r = results?.[a.id];
          return (
            <li
              key={a.id}
              className="border border-border rounded-md p-3 flex items-start gap-3"
            >
              <input
                type="checkbox"
                checked={selected.has(a.id)}
                disabled={!a.configured || running}
                onChange={() => toggle(a.id)}
                className="mt-0.5"
                aria-label={a.label}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-foreground">{a.label}</span>
                  {!a.configured && (
                    <span className="text-[10px] uppercase tracking-wide text-muted-foreground border border-border rounded px-1.5 py-0.5">
                      Not configured
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">{a.description}</p>
                {r && (
                  <p
                    className={`text-xs mt-1.5 ${
                      r.status === "ok"
                        ? "text-accent-teal"
                        : r.status === "error"
                          ? "text-destructive"
                          : "text-muted-foreground"
                    }`}
                  >
                    {r.status === "ok" ? "✓ " : r.status === "error" ? "✗ " : "– "}
                    {r.message}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      <div className="flex justify-end gap-2 mt-4">
        <button
          type="button"
          disabled={running}
          onClick={() => run([...selected])}
          className="px-3 py-1.5 text-sm font-medium rounded-md border border-border hover:bg-muted disabled:opacity-60 transition-colors"
        >
          {running ? "Running…" : "Run selected"}
        </button>
        <button
          type="button"
          disabled={running}
          onClick={() => run(AUTOMATIONS.filter((a) => a.configured).map((a) => a.id))}
          className="px-3 py-1.5 text-sm font-medium rounded-md bg-accent-coral text-white hover:bg-accent-coral/90 disabled:opacity-60 transition-colors"
        >
          {running ? "Running…" : "Run all"}
        </button>
      </div>
    </Modal>
  );
}
