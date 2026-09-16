import { useState } from "react";
import { useRevalidator } from "react-router";
import { Modal, ModalHeader } from "~/components/Modal";
import { modalCardClass } from "~/components/os-chrome";
import { cn } from "~/lib/cn";
import { Button } from "~/components/ui/Button";
import { Checkbox } from "~/components/ui/Checkbox";

type Automation = "assignments" | "slack" | "gmail" | "github";

type StepResult = { status: "ok" | "skipped" | "error"; message: string };

type ProjectOutcome = {
  projectId: string;
  // finalizeStaffing returns { results } for a real run (we never send
  // saveFieldsOnly here), or the route reports a per-project error string.
  results?: { results?: Partial<Record<Automation, StepResult>> };
  error?: string;
};

// Same automations as the per-project Finalize modal, but bulk finalize can't
// edit each project's Slack channel / GitHub slug — those steps use the value
// stored on the project (or the name-derived default). Assignments is the only
// one checked by default: propagating rosters across the cohort is safe and
// side-effect-free, whereas Slack/Gmail/GitHub each fan out to every project's
// external surface, so a lead opts into those deliberately.
const AUTOMATIONS: { id: Automation; label: string; description: string }[] = [
  {
    id: "assignments",
    label: "Propagate assignments",
    description:
      "Confirm proposed staffing rows and write canonical ProjectAssignment + DomainEligibility for every project.",
  },
  {
    id: "slack",
    label: "Post rosters to Slack",
    description: "Announce each project's confirmed roster in its staffing channel.",
  },
  {
    id: "github",
    label: "Set up GitHub teams",
    description: "Create each project's GitHub team and add its confirmed roster.",
  },
  {
    id: "gmail",
    label: "Create team email groups",
    description: "Get-or-create each project's -team Google Group and add its confirmed roster.",
  },
];

export function FinalizeAllModal({
  open,
  onClose,
  cycleId,
  projects,
}: {
  open: boolean;
  onClose: () => void;
  cycleId: string;
  projects: { id: string; name: string }[];
}) {
  const revalidator = useRevalidator();
  const [selected, setSelected] = useState<Set<Automation>>(() => new Set<Automation>(["assignments"]));
  const [promoteMentors, setPromoteMentors] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcomes, setOutcomes] = useState<ProjectOutcome[] | null>(null);

  const projectName = (id: string) => projects.find((p) => p.id === id)?.name ?? "project";

  function toggle(id: Automation) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function run() {
    if (selected.size === 0) {
      setError("Select at least one automation.");
      return;
    }
    setRunning(true);
    setError(null);
    setOutcomes(null);
    try {
      const res = await fetch("/api/staffing/finalize-all", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cycleId,
          projectIds: projects.map((p) => p.id),
          automations: [...selected],
          promoteMentors,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        projects?: ProjectOutcome[];
        error?: string;
      };
      if (!res.ok) {
        setError(json.error ?? `Request failed: ${res.status}`);
        return;
      }
      setOutcomes(json.projects ?? []);
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
      labelledBy="finalize-all-modal-title"
      containerClassName={modalCardClass("max-w-lg")}
      disableEscape={running}
    >
      <ModalHeader
        titleId="finalize-all-modal-title"
        title="Finalize all projects"
        subtitle={`Run the selected automations for all ${projects.length} board project${
          projects.length === 1 ? "" : "s"
        }. Safe to re-run.`}
        onClose={onClose}
        hideClose={running}
      />

      {error && (
        <div className="bg-destructive/10 border border-destructive/30 text-destructive text-sm rounded-md px-3 py-2 mb-3">
          {error}
        </div>
      )}

      <div className="mb-3 rounded-md border border-border bg-os-well px-3 py-2.5">
        <Checkbox
          checked={promoteMentors}
          disabled={running}
          onChange={(e) => setPromoteMentors(e.target.checked)}
          label="Promote staged mentors to P3"
          description="Where a project has a member flagged to mentor who isn't P3 yet, promote them (assignment + eligibility) so the pairing is valid. Uncheck to pair without promoting."
          className="text-sm"
        />
      </div>

      <ul className="flex flex-col gap-2">
        {AUTOMATIONS.map((a) => (
          <li key={a.id} className={cn("p-3 flex items-start gap-3", "rounded-os-item bg-os-well")}>
            <Checkbox
              checked={selected.has(a.id)}
              disabled={running}
              onChange={() => toggle(a.id)}
              aria-label={a.label}
            />
            <div className="min-w-0 flex-1">
              <span className="text-sm font-medium text-foreground">{a.label}</span>
              <p className="text-xs text-muted-foreground mt-0.5">{a.description}</p>
            </div>
          </li>
        ))}
      </ul>

      {outcomes && (
        <div className="mt-4 border-t border-border pt-3">
          <p className="text-xs font-medium text-muted-foreground mb-2">Results</p>
          <ul className="flex flex-col gap-2 max-h-64 overflow-y-auto">
            {outcomes.map((o) => {
              const steps = o.results?.results;
              return (
                <li key={o.projectId} className="text-sm">
                  <span className="font-medium text-foreground">{projectName(o.projectId)}</span>
                  {o.error ? (
                    <span className="text-destructive"> — ✗ {o.error}</span>
                  ) : steps ? (
                    <ul className="mt-0.5 ml-3 flex flex-col gap-0.5">
                      {[...selected].map((id) => {
                        const r = steps[id];
                        if (!r) return null;
                        return (
                          <li
                            key={id}
                            className={cn(
                              "text-xs",
                              r.status === "ok"
                                ? "text-accent-teal"
                                : r.status === "error"
                                  ? "text-destructive"
                                  : "text-muted-foreground",
                            )}
                          >
                            {r.status === "ok" ? "✓ " : r.status === "error" ? "✗ " : "– "}
                            {r.message}
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <span className="text-muted-foreground"> — no result</span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className="flex items-center justify-end gap-2 mt-4">
        <Button
          variant="primary"
          size="sm"
          disabled={running || selected.size === 0}
          onClick={() => void run()}
        >
          {running
            ? "Running…"
            : `Finalize all (${projects.length} project${projects.length === 1 ? "" : "s"})`}
        </Button>
      </div>
    </Modal>
  );
}
