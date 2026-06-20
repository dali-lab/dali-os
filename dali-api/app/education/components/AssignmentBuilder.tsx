import { useState } from "react";
import { useRevalidator } from "react-router";
import { Button } from "~/components/ui/Button";

interface AssignmentRow {
  id: string;
  title: string;
  dueAt: string | null;
  submissionType: "Text" | "File" | "Mixed";
  submissionCount: number;
  instructionsDocId: string | null;
}

export function AssignmentBuilder({
  offeringId,
  assignments,
}: {
  offeringId: string;
  assignments: AssignmentRow[];
}) {
  const { revalidate } = useRevalidator();
  const [draft, setDraft] = useState({
    title: "",
    submissionType: "Mixed" as "Text" | "File" | "Mixed",
    dueAt: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function create() {
    if (!draft.title.trim()) {
      setError("Title required");
      return;
    }
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/education/offerings/${offeringId}/assignments`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: draft.title,
        submissionType: draft.submissionType,
        dueAt: draft.dueAt ? new Date(draft.dueAt).toISOString() : null,
      }),
    });
    setBusy(false);
    if (res.ok) {
      setDraft({ title: "", submissionType: "Mixed", dueAt: "" });
      revalidate();
    } else {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Failed to create");
    }
  }

  async function remove(id: string) {
    if (!confirm("Delete this assignment and all its submissions?")) return;
    const res = await fetch(`/api/education/assignments/${id}`, {
      method: "DELETE",
      credentials: "include",
    });
    if (res.ok) revalidate();
  }

  async function startInstructions(id: string) {
    const res = await fetch(`/api/education/assignments/${id}/instructions-doc`, {
      method: "POST",
      credentials: "include",
    });
    if (res.ok) {
      const { docId } = await res.json();
      window.open(`/documents/${docId}`, "_blank", "noopener");
      revalidate();
    }
  }

  return (
    <div className="space-y-4">
      {assignments.length === 0 ? (
        <p className="text-sm text-muted-foreground italic">No assignments yet.</p>
      ) : (
        <ul className="space-y-2">
          {assignments.map((a) => (
            <li key={a.id} className="flex items-center justify-between rounded-lg border border-border bg-card p-3 text-sm">
              <div>
                <div className="font-semibold text-dark-blue">{a.title}</div>
                <div className="text-xs text-muted-foreground">
                  {a.submissionType} · {a.dueAt ? `Due ${new Date(a.dueAt).toLocaleString()}` : "No due date"} ·{" "}
                  {a.submissionCount} submission{a.submissionCount === 1 ? "" : "s"}
                </div>
              </div>
              <div className="flex items-center gap-3">
                {a.instructionsDocId ? (
                  <a
                    href={`/documents/${a.instructionsDocId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-accent-coral hover:underline"
                  >
                    Instructions ↗
                  </a>
                ) : (
                  <button
                    onClick={() => startInstructions(a.id)}
                    className="text-xs text-muted-foreground hover:text-dark-blue"
                  >
                    + Instructions doc
                  </button>
                )}
                <a
                  href={`/education/manage/assignments/${a.id}`}
                  className="text-xs text-accent-coral hover:underline"
                >
                  Submissions →
                </a>
                <button onClick={() => remove(a.id)} className="text-xs text-red-600 hover:underline">
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="rounded-lg border border-dashed border-border bg-card p-3 space-y-2">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          New assignment
        </h4>
        <input
          placeholder="Title"
          value={draft.title}
          onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm"
        />
        <div className="flex items-center gap-3">
          <label className="text-xs text-muted-foreground">
            Submission type
            <select
              value={draft.submissionType}
              onChange={(e) =>
                setDraft({ ...draft, submissionType: e.target.value as "Text" | "File" | "Mixed" })
              }
              className="ml-2 rounded-lg border border-border bg-card px-2 py-1 text-sm"
            >
              <option value="Text">Text</option>
              <option value="File">File</option>
              <option value="Mixed">Text + file</option>
            </select>
          </label>
          <label className="text-xs text-muted-foreground">
            Due
            <input
              type="datetime-local"
              value={draft.dueAt}
              onChange={(e) => setDraft({ ...draft, dueAt: e.target.value })}
              className="ml-2 rounded-lg border border-border bg-card px-2 py-1 text-sm"
            />
          </label>
        </div>
        {error && <div className="text-sm text-red-700">{error}</div>}
        <Button size="sm" variant="secondary" disabled={busy} onClick={create}>
          {busy ? "Adding..." : "Add assignment"}
        </Button>
      </div>
    </div>
  );
}
