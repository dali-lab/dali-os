import { useState } from "react";
import { Form, useNavigate } from "react-router";
import { Trash2 } from "lucide-react";
import { useDialog } from "~/components/ui/dialog";
import { Button } from "~/components/ui/Button";
import {
  DomainScopesSegment,
  DomainsSegment,
  MeetingNoteTemplateSegment,
  RecordingPolicySegment,
  StatusSegment,
  TermsSegment,
  VisibilitySegment,
} from "~/projects/components/detail/DetailsSegments";
import { type LoaderData } from "~/projects/components/detail/types";

// Admin/Core only. Deletion is permanent and the server refuses it once a
// project has any history, so the affordance stays tucked inside settings and
// asks for the project name typed back before it fires.
// Save the project's structure (epics, sprints, tasks, checklists) as a
// reusable template. Posts to the /projects action (intent=capture). Rendered
// for Core (canEditScope) as a sibling of the Danger zone in the settings modal.
export function SaveAsTemplateSection({
  projectId,
  projectName,
}: {
  projectId: string;
  projectName: string;
}) {
  return (
    <section className="mt-6 border-t border-border pt-5">
      <h3 className="text-sm font-semibold text-foreground">Save as template</h3>
      <p className="mt-1 text-xs text-muted-foreground">
        Capture this project's epics, sprints, and tasks (with checklists) as a reusable
        template. Sprint dates are stored as offsets and rebased when a new project is created
        from it. Collaborative doc bodies are not copied.
      </p>
      <Form method="post" action="/projects" className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
        <input type="hidden" name="intent" value="capture" />
        <input type="hidden" name="projectId" value={projectId} />
        <label className="flex flex-1 flex-col gap-1 text-xs">
          <span className="text-muted-foreground">Template name</span>
          <input
            name="templateName"
            required
            defaultValue={`${projectName} template`}
            className="px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-os-accent/30"
          />
        </label>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground pb-2">
          <input type="checkbox" name="includeOverviewPage" className="accent-os-accent" />
          Include Overview page
        </label>
        <Button type="submit" size="sm">
          Save template
        </Button>
      </Form>
    </section>
  );
}
export function DeleteProjectSection({
  projectId,
  projectName,
}: {
  projectId: string;
  projectName: string;
}) {
  const dialog = useDialog();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState<{ label: string; count: number }[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onDelete() {
    setBlocked(null);
    setError(null);

    const typed = await dialog.prompt({
      title: `Delete "${projectName}"?`,
      description:
        "This permanently removes the project. It can't be undone. Archiving keeps the project and its history instead.",
      label: `Type the project name to confirm`,
      placeholder: projectName,
      confirmLabel: "Delete project",
      tone: "destructive",
      validate: (value) =>
        value.trim() === projectName ? null : "That doesn't match the project name.",
    });
    if (typed === null) return;

    setBusy(true);
    try {
      const res = await fetch(`/api/projects/${projectId}`, { method: "DELETE" });
      if (res.ok) {
        navigate("/projects");
        return;
      }
      const body = (await res.json().catch(() => null)) as
        | { error?: string; blocking?: { label: string; count: number }[] }
        | null;
      if (res.status === 409 && body?.blocking?.length) {
        setBlocked(body.blocking);
        return;
      }
      setError(body?.error ?? "Could not delete this project.");
    } catch {
      setError("Could not delete this project.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-6 border-t border-border pt-5">
      <h3 className="text-sm font-semibold text-destructive">Danger zone</h3>
      <p className="mt-1 text-xs text-muted-foreground">
        Deleting is permanent and only possible while a project has no staffing, tasks,
        meetings, time entries or budget records. Archive it instead to retire a project
        that has history.
      </p>

      {blocked && (
        <div className="mt-3 rounded-md border border-border bg-muted/40 p-3">
          <p className="text-xs font-medium text-foreground">
            Still attached to this project:
          </p>
          <ul className="mt-1.5 space-y-0.5">
            {blocked.map((b) => (
              <li key={b.label} className="text-xs text-muted-foreground">
                {b.count} {b.label}
              </li>
            ))}
          </ul>
        </div>
      )}
      {error && <p className="mt-3 text-xs text-destructive">{error}</p>}

      <button
        type="button"
        onClick={onDelete}
        disabled={busy}
        className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-destructive/40 px-3 py-1.5 text-sm font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50"
      >
        <Trash2 className="h-4 w-4" aria-hidden />
        {busy ? "Deleting…" : "Delete project"}
      </button>
    </section>
  );
}
export function ScopeTab({
  project,
  allDomainOptions,
  plannedTerms,
  allTermOptions,
  domainScopeGrid,
  canEdit,
  actionError,
}: {
  project: LoaderData["project"];
  allDomainOptions: LoaderData["allDomainOptions"];
  plannedTerms: LoaderData["plannedTerms"];
  allTermOptions: LoaderData["allTermOptions"];
  domainScopeGrid: LoaderData["domainScopeGrid"];
  canEdit: boolean;
  actionError?: string;
}) {
  return (
    <div className="flex flex-col gap-4">
      {actionError && (
        <div className="bg-destructive/10 border border-destructive/30 text-destructive text-sm rounded-md px-3 py-2">
          {actionError}
        </div>
      )}

      <StatusSegment status={project.status} canEdit={canEdit} />

      <VisibilitySegment isPrivate={project.isPrivate} canEdit={canEdit} />

      <RecordingPolicySegment recordingPolicy={project.recordingPolicy} canEdit={canEdit} />

      <MeetingNoteTemplateSegment meetingNoteTemplate={project.meetingNoteTemplate} />

      {/* Declared domains — editable; if none declared the derived set from
          assignments + bids is shown as a fallback so a freshly-created
          project that's mid-staffing still has visible domain context. */}
      <DomainsSegment
        declared={project.domains}
        derived={project.derivedDomains}
        allDomains={allDomainOptions}
        canEdit={canEdit}
      />

      {/* Project terms — the editable term set. Start term and active-this-term
          are derived from this set; termCount (Details) is the expected target. */}
      <TermsSegment
        selected={plannedTerms}
        allTerms={allTermOptions}
        expected={project.termCount}
        canEdit={canEdit}
      />

      {/* Per-domain, per-term scope grid. One cell per (declared domain ×
          planned term). Empty cell = no scope written yet. Auto-saves on
          blur; clearing a cell to empty deletes the row. */}
      {project.domains.length > 0 && plannedTerms.length > 0 && (
        <DomainScopesSegment
          domains={project.domains}
          terms={plannedTerms}
          grid={domainScopeGrid}
          canEdit={canEdit}
        />
      )}
    </div>
  );
}
