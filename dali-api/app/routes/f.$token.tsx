import { useState } from "react";
import { useLoaderData } from "react-router";
import type { Route } from "./+types/f.$token";
import { loadPublicForm } from "~/forms/lib/public-form";
import { ChallengeQuestionField } from "~/hiring/components/ChallengeQuestionField";
import { RichTextViewer, isEmptyDoc } from "~/components/RichTextViewer";
import type { Question } from "~/types";

export const meta: Route.MetaFunction = ({ data }) => [
  { title: `${(data as { name?: string })?.name ?? "Form"} · DALI` },
];

// PUBLIC, UNAUTHENTICATED loader — no requireAuth. A 404 (thrown Response)
// covers unknown token, unpublished form, and no-version uniformly so we
// don't leak which.
export async function loader({ params }: Route.LoaderArgs) {
  const form = await loadPublicForm(params.token!);
  if (!form) throw new Response("Not found", { status: 404 });
  return form;
}

export default function PublicFormFill() {
  const data = useLoaderData();
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "submitting" | "done">("idle");
  const [error, setError] = useState<string | null>(null);

  const questions: Question[] = data.questions;
  const hasRequiredFile = questions.some(
    (q) => q.required && q.type === "file",
  );

  function set(key: string, v: string) {
    setAnswers((a) => ({ ...a, [key]: v }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    // Client-side required check (server re-validates).
    for (const q of questions) {
      if (!q.required || q.type === "file") continue;
      if (!answers[q.key]?.trim()) {
        setError(`"${q.data.label}" is required.`);
        return;
      }
    }
    setState("submitting");
    try {
      const res = await fetch(`/api/f/${data.token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          versionId: data.versionId,
          answers,
          submitterName: name || undefined,
          submitterEmail: email || undefined,
        }),
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
      <Shell>
        <div className="text-center py-10">
          <h1 className="font-heading text-xl font-bold text-dark-blue">
            Thanks!
          </h1>
          <p className="text-sm text-muted-foreground mt-2">
            Your response to “{data.name}” has been recorded.
          </p>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <h1 className="font-heading text-2xl font-bold text-dark-blue">
        {data.name}
      </h1>
      {data.description && !isEmptyDoc(data.description) && (
        <div className="mt-2 text-sm text-muted-foreground">
          <RichTextViewer content={data.description} />
        </div>
      )}

      {hasRequiredFile && (
        <div className="mt-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          This form has a required file upload, which isn’t supported on the
          public link. Please contact the lab to complete it another way.
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
                File uploads aren’t available on the public link.
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

        <div className="border-t border-border pt-5 flex flex-col gap-3">
          <p className="text-xs text-muted-foreground">
            Optional — so we know who responded.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input
              type="text"
              placeholder="Your name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="rounded-lg border border-border bg-card text-sm px-3 py-2 text-dark-blue"
            />
            <input
              type="email"
              placeholder="Your email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="rounded-lg border border-border bg-card text-sm px-3 py-2 text-dark-blue"
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={state === "submitting"}
          className="self-start px-4 py-2 text-sm font-medium rounded-lg bg-accent-coral text-white hover:bg-accent-coral/90 disabled:opacity-60 transition-colors"
        >
          {state === "submitting" ? "Submitting…" : "Submit"}
        </button>
      </form>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-section-bg p-4 sm:p-8">
      <div className="mx-auto max-w-2xl bg-card border border-border rounded-xl p-6 sm:p-8">
        <div className="flex items-center gap-2 mb-6">
          <div className="w-7 h-7 bg-accent-coral rounded-md flex items-center justify-center">
            <span className="text-white font-bold text-base leading-none font-heading">
              D
            </span>
          </div>
          <span className="font-heading text-sm font-bold text-dark-blue">
            DALI
          </span>
        </div>
        {children}
      </div>
    </div>
  );
}
