import { useState } from "react";
import { useNavigate } from "react-router";
import { Button } from "~/components/ui/Button";

export interface ApplicationFormProps {
  offeringId: string;
  offeringTitle: string;
  questions: { id: string; prompt: string; required: boolean }[];
  initialAnswers?: Record<string, string>;
  submitTo: string; // API endpoint
  redirectAfter: string; // where to send the user after successful submit
  submitLabel?: string;
}

export function ApplicationForm(props: ApplicationFormProps) {
  const [answers, setAnswers] = useState<Record<string, string>>(
    () => props.initialAnswers ?? {},
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch(props.submitTo, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          answers: props.questions.map((q) => ({
            questionId: q.id,
            content: answers[q.id] ?? "",
          })),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? "Unable to submit");
        return;
      }
      navigate(props.redirectAfter);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-2xl mx-auto space-y-5">
      <h1 className="font-heading text-2xl font-bold text-dark-blue mb-2">
        Apply to {props.offeringTitle}
      </h1>
      {props.questions.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No questions — just confirm your spot by submitting below.
        </p>
      )}
      {props.questions.map((q) => (
        <label key={q.id} className="block">
          <span className="block text-sm font-semibold text-dark-blue mb-1">
            {q.prompt} {q.required && <span className="text-accent-coral">*</span>}
          </span>
          <textarea
            value={answers[q.id] ?? ""}
            onChange={(e) => setAnswers((prev) => ({ ...prev, [q.id]: e.target.value }))}
            required={q.required}
            rows={4}
            className="w-full rounded-lg border border-border bg-card p-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent-teal"
          />
        </label>
      ))}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      )}
      <Button type="submit" variant="primary" disabled={submitting}>
        {submitting ? "Submitting..." : (props.submitLabel ?? "Submit")}
      </Button>
    </form>
  );
}
