import { useState } from "react";
import { useRevalidator } from "react-router";
import { Button } from "~/components/ui/Button";
import { Modal } from "~/components/Modal";
import type { Sprint } from "~/generated/prisma/client";
import type { WorkspaceData } from "~/projects/lib/queries";
import type { ProjectMembership } from "~/lib/projectAuth";

interface Props {
  data: {
    sprints: Sprint[];
    taskCounts: { sprintId: string | null; status: string; _count: number }[];
  };
  workspace: WorkspaceData;
  membership: ProjectMembership;
}

const STATUS_COLOR: Record<string, string> = {
  Planned: "bg-muted text-muted-foreground",
  Active: "bg-accent-coral/10 text-accent-coral",
  Closed: "bg-muted/50 text-muted-foreground",
};

export function SprintsTab({ data, workspace, membership }: Props) {
  const revalidator = useRevalidator();
  const [createOpen, setCreateOpen] = useState(false);
  const [closingSprintId, setClosingSprintId] = useState<string | null>(null);

  const tasksBySprint = new Map<string | "null", { open: number; total: number }>();
  for (const tc of data.taskCounts) {
    const key = tc.sprintId ?? "null";
    let bucket = tasksBySprint.get(key);
    if (!bucket) {
      bucket = { open: 0, total: 0 };
      tasksBySprint.set(key, bucket);
    }
    bucket.total += tc._count;
    if (tc.status !== "Done" && tc.status !== "Cancelled") {
      bucket.open += tc._count;
    }
  }

  async function setStatus(sprintId: string, status: Sprint["status"]) {
    await fetch(`/api/projects/${workspace.project.id}/sprints/${sprintId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    revalidator.revalidate();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-foreground">Sprints</h2>
        {membership.canEdit && (
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            + New sprint
          </Button>
        )}
      </div>

      {data.sprints.length === 0 ? (
        <p className="text-sm text-muted-foreground italic">
          No sprints yet. Create one to start scheduling tasks.
        </p>
      ) : (
        <ul className="space-y-2">
          {data.sprints.map((s) => {
            const bucket = tasksBySprint.get(s.id) ?? { open: 0, total: 0 };
            return (
              <li
                key={s.id}
                className="rounded-xl border border-border bg-card p-4 flex flex-wrap items-center gap-3 justify-between"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-foreground">{s.name}</span>
                    <span
                      className={`text-[10px] uppercase font-semibold tracking-wider px-1.5 py-0.5 rounded ${
                        STATUS_COLOR[s.status] ?? ""
                      }`}
                    >
                      {s.status}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {fmtDate(s.startsAt)} – {fmtDate(s.endsAt)} · {bucket.open}/{bucket.total} open
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {membership.canEdit && s.status === "Planned" && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setStatus(s.id, "Active")}
                    >
                      Start
                    </Button>
                  )}
                  {membership.canEdit && s.status === "Active" && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setClosingSprintId(s.id)}
                    >
                      Close
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {createOpen && (
        <SprintCreateModal
          projectId={workspace.project.id}
          onClose={() => setCreateOpen(false)}
          onCreated={() => {
            setCreateOpen(false);
            revalidator.revalidate();
          }}
        />
      )}

      {closingSprintId && (
        <SprintCloseModal
          projectId={workspace.project.id}
          sprintId={closingSprintId}
          openTaskCount={
            (tasksBySprint.get(closingSprintId) ?? { open: 0 }).open
          }
          onClose={() => setClosingSprintId(null)}
          onClosed={() => {
            setClosingSprintId(null);
            revalidator.revalidate();
          }}
        />
      )}
    </div>
  );
}

function fmtDate(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function SprintCreateModal({
  projectId,
  onClose,
  onCreated,
}: {
  projectId: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [startsAt, setStartsAt] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [endsAt, setEndsAt] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 14);
    return d.toISOString().slice(0, 10);
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (submitting) return;
    if (!name.trim()) {
      setError("Name required");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/sprints`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), startsAt, endsAt }),
      });
      if (!res.ok) {
        setError(await res.text());
        return;
      }
      onCreated();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open onClose={onClose} labelledBy="sprint-create-title">
      <h2 id="sprint-create-title" className="text-lg font-semibold mb-3">
        New sprint
      </h2>
      <div className="space-y-3">
        <FieldRow label="Name">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm"
          />
        </FieldRow>
        <div className="grid grid-cols-2 gap-3">
          <FieldRow label="Starts">
            <input
              type="date"
              value={startsAt}
              onChange={(e) => setStartsAt(e.target.value)}
              className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm"
            />
          </FieldRow>
          <FieldRow label="Ends">
            <input
              type="date"
              value={endsAt}
              onChange={(e) => setEndsAt(e.target.value)}
              className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm"
            />
          </FieldRow>
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" onClick={submit} disabled={submitting}>
            {submitting ? "Creating…" : "Create"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function SprintCloseModal({
  projectId,
  sprintId,
  openTaskCount,
  onClose,
  onClosed,
}: {
  projectId: string;
  sprintId: string;
  openTaskCount: number;
  onClose: () => void;
  onClosed: () => void;
}) {
  const [destination, setDestination] = useState<"backlog" | "nextSprint">("backlog");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/projects/${projectId}/sprints/${sprintId}/close`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ destination }),
        },
      );
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(j.error ?? `Close failed (${res.status})`);
        return;
      }
      onClosed();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open onClose={onClose} labelledBy="sprint-close-title">
      <h2 id="sprint-close-title" className="text-lg font-semibold mb-2">
        Close sprint
      </h2>
      <p className="text-sm text-muted-foreground mb-3">
        {openTaskCount === 0
          ? "All tasks in this sprint are done. Closing now."
          : `${openTaskCount} open task${openTaskCount === 1 ? "" : "s"} will be moved.`}
      </p>
      {openTaskCount > 0 && (
        <div className="space-y-1.5 text-sm mb-3">
          <label className="flex items-center gap-2">
            <input
              type="radio"
              checked={destination === "backlog"}
              onChange={() => setDestination("backlog")}
            />
            Move to backlog
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              checked={destination === "nextSprint"}
              onChange={() => setDestination("nextSprint")}
            />
            Move to next Planned/Active sprint
          </label>
        </div>
      )}
      {error && <p className="text-xs text-destructive mb-2">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button size="sm" onClick={submit} disabled={submitting}>
          {submitting ? "Closing…" : "Close sprint"}
        </Button>
      </div>
    </Modal>
  );
}

function FieldRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-muted-foreground mb-1">
        {label}
      </label>
      {children}
    </div>
  );
}
