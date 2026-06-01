import { useState } from "react";
import { ChallengeQuestionField } from "~/hiring/components/ChallengeQuestionField";
import { RichTextViewer, isEmptyDoc } from "~/components/RichTextViewer";
import type { Question } from "~/types";

// The shared authenticated form-fill UI. Rendered both by /forms/fill/:token
// and inline by /onboarding (so onboarding has no cross-URL redirect — the tab
// URL matches its content in the embedded workspace). The caller passes the
// already-loaded form data (from loadPublicForm) + its token; submission posts
// to /api/forms/fill/:token, same as before.

export type MemberFormData = {
  name: string;
  description: unknown;
  versionId: string;
  questions: Question[];
  token: string;
};

export function MemberFormFillView({
  data,
  // Optional: rendered on the "Submitted" screen instead of the default copy.
  doneContent,
}: {
  data: MemberFormData;
  doneContent?: React.ReactNode;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [state, setState] = useState<"idle" | "submitting" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  const questions = data.questions;

  function set(key: string, v: string) {
    setAnswers((a) => ({ ...a, [key]: v }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    for (const q of questions) {
      if (!q.required || q.type === "file") continue;
      if (!answers[q.key]?.trim()) {
        setError(`"${q.data.label}" is required.`);
        return;
      }
    }
    setState("submitting");
    try {
      const res = await fetch(`/api/forms/fill/${data.token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ versionId: data.versionId, answers }),
      });
      const out = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(out.error ?? `Submission failed (${res.status}).`);
        setState("idle");
        return;
      }
      setState("done");
    } catch {
      setError("Network error — please try again.");
      setState("idle");
    }
  }

  if (state === "done") {
    return (
      <div className="text-center py-10">
        {doneContent ?? (
          <>
            <h1 className="font-heading text-xl font-bold text-dark-blue">
              Submitted
            </h1>
            <p className="text-sm text-muted-foreground mt-2">
              Your response to “{data.name}” has been recorded.
            </p>
          </>
        )}
      </div>
    );
  }

  return (
    <>
      <h1 className="font-heading text-2xl font-bold text-dark-blue">
        {data.name}
      </h1>
      {data.description && !isEmptyDoc(data.description) && (
        <div className="mt-2 text-sm text-muted-foreground">
          <RichTextViewer content={data.description} />
        </div>
      )}

      {error && (
        <div className="mt-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      <form onSubmit={submit} className="mt-6 flex flex-col gap-5">
        {questions.map((q) => (
          <div key={q.key}>
            <label className="block text-sm font-medium text-dark-blue mb-1">
              {q.data.label}
              {q.required && <span className="text-destructive"> *</span>}
            </label>
            {q.data.description && (
              <p className="text-xs text-muted-foreground mb-1.5">
                {q.data.description}
              </p>
            )}
            {q.type === "file" ? (
              <div className="text-xs text-muted-foreground italic border border-dashed border-border rounded-md px-3 py-2">
                File uploads aren’t available here.
              </div>
            ) : (
              <ChallengeQuestionField
                question={q}
                value={answers[q.key] ?? ""}
                onChange={(v) => set(q.key, v)}
              />
            )}
          </div>
        ))}

        <button
          type="submit"
          disabled={state === "submitting"}
          className="self-start px-4 py-2 text-sm font-medium rounded-lg bg-accent-coral text-white hover:bg-accent-coral/90 disabled:opacity-60 transition-colors"
        >
          {state === "submitting" ? "Submitting…" : "Submit"}
        </button>
      </form>
    </>
  );
}

// The branded card chrome both routes wrap the form in.
export function MemberFormShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-section-bg p-4 sm:p-8 pt-10 sm:pt-16">
      <div className="mx-auto max-w-2xl bg-card border border-border rounded-xl p-6 sm:p-8">
        <div className="flex items-center gap-2 mb-6">
          <div className="w-7 h-7 bg-accent-coral rounded-md flex items-center justify-center">
            <span className="text-white font-bold text-base leading-none font-heading">
              D
            </span>
          </div>
          <span className="font-heading text-sm font-bold text-dark-blue">
            DALI OS
          </span>
        </div>
        {children}
      </div>
    </div>
  );
}
