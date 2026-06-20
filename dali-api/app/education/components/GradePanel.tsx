import { useState } from "react";
import { useRevalidator } from "react-router";
import { Button } from "~/components/ui/Button";

export interface GradePanelProps {
  submissionId: string;
  initialFeedback: string;
  initialGraded: boolean;
}

export function GradePanel(props: GradePanelProps) {
  const { revalidate } = useRevalidator();
  const [feedback, setFeedback] = useState(props.initialFeedback);
  const [graded, setGraded] = useState(props.initialGraded);
  const [busy, setBusy] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function save(targetGraded: boolean) {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/education/submissions/${props.submissionId}/grade`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ feedback, graded: targetGraded }),
    });
    setBusy(false);
    if (res.ok) {
      setGraded(targetGraded);
      setSavedAt(new Date().toLocaleTimeString());
      revalidate();
    } else {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Save failed");
    }
  }

  return (
    <div className="mt-3 rounded-lg border border-border bg-brand-tint/40 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Feedback {graded && <span className="ml-2 text-green-700">· Graded</span>}
        </span>
        {savedAt && <span className="text-xs text-muted-foreground">Saved {savedAt}</span>}
      </div>
      <textarea
        value={feedback}
        onChange={(e) => setFeedback(e.target.value)}
        rows={3}
        placeholder="Visible to the student on their assignment page."
        className="w-full rounded-lg border border-border bg-card p-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-teal"
      />
      {error && <div className="text-sm text-red-700">{error}</div>}
      <div className="flex items-center gap-2">
        <Button size="sm" variant="primary" disabled={busy} onClick={() => save(true)}>
          {graded ? "Update feedback" : "Mark graded"}
        </Button>
        {graded && (
          <button
            onClick={() => save(false)}
            disabled={busy}
            className="text-xs text-muted-foreground hover:underline"
          >
            Un-grade
          </button>
        )}
      </div>
    </div>
  );
}
