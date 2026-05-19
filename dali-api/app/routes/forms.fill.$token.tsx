import { useState } from "react";
import { redirect, useLoaderData } from "react-router";
import type { Route } from "./+types/forms.fill.$token";
import { requireAuth } from "~/lib/auth";
import { requireMember } from "~/lib/roles";
import { loadPublicForm } from "~/forms/lib/public-form";
import { ChallengeQuestionField } from "~/hiring/components/ChallengeQuestionField";
import { RichTextViewer, isEmptyDoc } from "~/components/RichTextViewer";
import type { Question } from "~/types";

export const meta: Route.MetaFunction = ({ data }) => [
  { title: `${(data as { name?: string })?.name ?? "Form"} · DALI OS` },
];

// AUTHENTICATED member fill route for slot-bound forms (Project Bids etc.).
// Identity comes from the session — no name/email capture — which is what
// lets a submission be interpreted into StaffingPreference for this member.
// Reuses loadPublicForm (token-addressed, published-only) for the form body.
export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");
  if (auth.user.type === "applicant") return redirect("/portal");
  // Only lab members submit staffing forms; the level/eligibility a bid needs
  // only exists for members.
  if (!(await requireMember(auth.user.sub))) return redirect("/");

  const form = await loadPublicForm(params.token!);
  if (!form) throw new Response("Not found", { status: 404 });
  // loadPublicForm doesn't echo the token back; the submit endpoint is
  // addressed by it, so pass it through explicitly.
  return { ...form, token: params.token! };
}

export default function MemberFormFill() {
  const data = useLoaderData<typeof loader>();
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [state, setState] = useState<"idle" | "submitting" | "done">("idle");
  const [error, setError] = useState<string | null>(null);

  const questions: Question[] = data.questions;

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
      <Shell>
        <div className="text-center py-10">
          <h1 className="font-heading text-xl font-bold text-dark-blue">
            Submitted
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
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
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
