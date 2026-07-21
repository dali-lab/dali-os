import { useEffect, useState } from "react";
import { useRevalidator } from "react-router";
import { Modal, ModalHeader } from "~/components/Modal";
import { Button } from "~/components/ui/Button";

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
    label: "Create team email group",
    description:
      "Get-or-create the project's -team Google Group and add the confirmed roster to it.",
    configured: true,
  },
];

export function FinalizeModal({
  open,
  onClose,
  cycleId,
  projectId,
  projectName,
  defaultSlackChannel,
  defaultGithubSlug,
}: {
  open: boolean;
  onClose: () => void;
  cycleId: string;
  projectId: string;
  projectName: string;
  // Pre-fill for the editable channel/team fields. Slack defaults to the
  // project-name-derived channel; GitHub to the project's stored slug (or "").
  defaultSlackChannel?: string;
  defaultGithubSlug?: string;
}) {
  const revalidator = useRevalidator();
  const [selected, setSelected] = useState<Set<Automation>>(
    () => new Set(AUTOMATIONS.filter((a) => a.configured).map((a) => a.id)),
  );
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<Partial<Record<Automation, StepResult>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Editable identifiers, shared with the project details page. Slack defaults to
  // the project's stored channel name (else derived); GitHub to its stored slug.
  const initialSlack = defaultSlackChannel ?? "";
  const initialGithub = defaultGithubSlug ?? "";
  const [slackChannel, setSlackChannel] = useState(initialSlack);
  const [githubSlug, setGithubSlug] = useState(initialGithub);
  const [savingFields, setSavingFields] = useState(false);
  const [savedNote, setSavedNote] = useState<string | null>(null);
  const fieldsDirty = slackChannel !== initialSlack || githubSlug !== initialGithub;

  // Mentors designated via the board's role badge who aren't P3 yet — finalize
  // can promote them. Loaded when the modal opens; drives the promote notice +
  // toggle below. Defaults to promoting (the common intent).
  const [nonP3Mentors, setNonP3Mentors] = useState<{ name: string }[]>([]);
  const [promoteMentors, setPromoteMentors] = useState(true);
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/staffing/mentor-role?cycleId=${encodeURIComponent(cycleId)}`, {
          credentials: "include",
        });
        if (!res.ok) return;
        const d = (await res.json()) as {
          nonP3Mentors: { userId: string; firstName: string; lastName: string }[];
        };
        if (!cancelled) {
          setNonP3Mentors(
            d.nonP3Mentors.map((m) => ({ name: `${m.firstName} ${m.lastName}`.trim() })),
          );
        }
      } catch {
        /* best-effort — the promote notice just won't show */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, cycleId]);

  // Persist the channel name + GitHub slug to the Project WITHOUT running
  // automations (keeps the project details page in sync). Cancel reverts edits.
  async function saveFields() {
    setSavingFields(true);
    setError(null);
    setSavedNote(null);
    try {
      const res = await fetch("/api/staffing/finalize", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cycleId,
          projectId,
          automations: [],
          saveFieldsOnly: true,
          slackChannel: slackChannel.trim(),
          githubTeamSlug: githubSlug.trim(),
        }),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        setError(json.error ?? `Save failed: ${res.status}`);
        return;
      }
      setSavedNote("Saved.");
      // Reflect the new values on the project details page if it's open.
      revalidator.revalidate();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setSavingFields(false);
    }
  }

  function cancelFields() {
    setSlackChannel(initialSlack);
    setGithubSlug(initialGithub);
    setSavedNote(null);
    setError(null);
  }

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
        body: JSON.stringify({
          cycleId,
          projectId,
          automations: ids,
          slackChannel: slackChannel.trim() || undefined,
          githubTeamSlug: githubSlug.trim() || undefined,
          promoteMentors,
        }),
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
      <ModalHeader
        titleId="finalize-modal-title"
        title={`Finalize ${projectName}`}
        subtitle="Run the selected automations. Safe to re-run."
        onClose={onClose}
        hideClose={running}
      />

      {error && (
        <div className="bg-destructive/10 border border-destructive/30 text-destructive text-sm rounded-md px-3 py-2 mb-3">
          {error}
        </div>
      )}

      {nonP3Mentors.length > 0 && (
        <div className="mb-3 rounded-md border border-accent-yellow/40 bg-accent-yellow/10 px-3 py-2.5">
          <label className="flex items-start gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={promoteMentors}
              disabled={running}
              onChange={(e) => setPromoteMentors(e.target.checked)}
              className="mt-0.5"
            />
            <span className="min-w-0">
              <span className="font-medium text-foreground">
                Promote {nonP3Mentors.length} mentor{nonP3Mentors.length === 1 ? "" : "s"} to P3
              </span>
              <span className="block text-xs text-muted-foreground mt-0.5">
                {nonP3Mentors.map((m) => m.name).join(", ")}{" "}
                {nonP3Mentors.length === 1 ? "is" : "are"} staged to mentor but not yet P3. Finalizing
                promotes {nonP3Mentors.length === 1 ? "them" : "them"} (assignment + eligibility) so the
                pairing is valid. Uncheck to pair without promoting.
              </span>
            </span>
          </label>
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
                {a.id === "slack" && (
                  <div className="mt-2">
                    <label
                      htmlFor="finalize-slack-channel"
                      className="block text-[11px] font-medium text-foreground"
                    >
                      Channel name
                    </label>
                    <input
                      id="finalize-slack-channel"
                      type="text"
                      value={slackChannel}
                      disabled={running || savingFields}
                      onChange={(e) => setSlackChannel(e.target.value)}
                      placeholder="project-name"
                      className="mt-1 w-full px-2 py-1 text-xs border border-border rounded-md bg-background text-foreground disabled:opacity-60"
                    />
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      Lowercase + hyphens. Shared with the project page. Save to sync; the
                      channel is get-or-created when this automation runs.
                    </p>
                  </div>
                )}
                {a.id === "github" && (
                  <div className="mt-2">
                    <label
                      htmlFor="finalize-github-slug"
                      className="block text-[11px] font-medium text-foreground"
                    >
                      Team slug
                    </label>
                    <input
                      id="finalize-github-slug"
                      type="text"
                      value={githubSlug}
                      disabled={running || savingFields}
                      onChange={(e) => setGithubSlug(e.target.value)}
                      placeholder="project-team"
                      className="mt-1 w-full px-2 py-1 text-xs border border-border rounded-md bg-background text-foreground disabled:opacity-60"
                    />
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      Shared with the project page. Save to sync; the team is get-or-created
                      when this automation runs.
                    </p>
                  </div>
                )}
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

      {/* Save/Cancel persist the channel + slug fields (synced to the project
          details page) without running automations. Shown only when edited. */}
      <div className="flex items-center justify-between gap-2 mt-4">
        <div className="flex items-center gap-2 min-h-[1.75rem]">
          {fieldsDirty && (
            <>
              <button
                type="button"
                disabled={savingFields || running}
                onClick={saveFields}
                className="px-3 py-1.5 text-sm font-medium rounded-md bg-accent-teal text-white hover:bg-accent-teal/90 disabled:opacity-60 transition-colors"
              >
                {savingFields ? "Saving…" : "Save fields"}
              </button>
              <button
                type="button"
                disabled={savingFields || running}
                onClick={cancelFields}
                className="px-3 py-1.5 text-sm font-medium rounded-md border border-border hover:bg-muted disabled:opacity-60 transition-colors"
              >
                Cancel
              </button>
            </>
          )}
          {savedNote && !fieldsDirty && (
            <span className="text-xs text-accent-teal">{savedNote}</span>
          )}
        </div>

        <div className="flex gap-2">
          <Button
            variant="primary"
            size="sm"
            disabled={running || savingFields || selected.size === 0}
            onClick={() => run([...selected])}
          >
            {running
              ? "Running…"
              : selected.size === AUTOMATIONS.filter((a) => a.configured).length
                ? "Finalize"
                : `Finalize (${selected.size})`}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
