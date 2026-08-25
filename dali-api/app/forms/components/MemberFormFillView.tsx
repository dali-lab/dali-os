import { useEffect, useMemo, useState } from "react";
import { ChevronLeft } from "lucide-react";
import { useNavigate } from "react-router";
import { desktopVersion } from "~/lib/desktop";
import { FormQuestionField } from "~/components/form-builder/QuestionField";
import { FormFieldList } from "~/forms/components/FormField";
import {
  useFormPager,
  FormPagerNav,
  FormPageHeading,
} from "~/forms/components/FormPager";
import { paginateQuestions } from "~/lib/form-pages";
import { DocEditor } from "~/components/doc";
import { isEmptyBlocks } from "~/lib/blocks";
import { Button } from "~/components/ui/Button";
import { findMissingRequired } from "~/lib/form-answers";
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
  // Fingerprint echoed back on submit so a mid-fill in-place edit is caught.
  versionUpdatedAt: string;
  questions: Question[];
  token: string;
};

export function MemberFormFillView({
  data,
  // Optional: rendered on the "Submitted" screen instead of the default copy.
  doneContent,
  // Optional extra fields merged into the submit body (e.g. the education
  // session/offering context the fill URL carried).
  extraBody,
  // Optional initial answers (question key → value) — e.g. the target domain a
  // Growth request CTA pre-fills from the hub it launched from.
  prefill,
}: {
  data: MemberFormData;
  doneContent?: React.ReactNode;
  extraBody?: Record<string, string | null>;
  prefill?: Record<string, string>;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>(() => ({
    ...prefill,
  }));
  const [state, setState] = useState<"idle" | "submitting" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  const questions = data.questions;
  const pages = useMemo(() => paginateQuestions(questions), [questions]);
  const pager = useFormPager(pages, { excludeFileType: true });

  function set(key: string, v: string) {
    setAnswers((a) => ({ ...a, [key]: v }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const missing = findMissingRequired(questions, (q) => answers[q.key], {
      excludeFileType: true,
    });
    if (missing.length > 0) {
      setError(`"${missing[0].data.label}" is required.`);
      return;
    }
    setState("submitting");
    try {
      const res = await fetch(`/api/forms/fill/${data.token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          versionId: data.versionId,
          versionUpdatedAt: data.versionUpdatedAt,
          answers,
          ...extraBody,
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
      {!isEmptyBlocks(data.description) && (
        <div className="mt-2 text-sm text-muted-foreground">
          <DocEditor
            features="notes"
            density="compact"
            editable={false}
            initialContent={data.description}
          />
        </div>
      )}

      {error && (
        <div className="mt-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      <form onSubmit={submit} className="mt-6 flex flex-col gap-5">
        <FormPageHeading page={pager.page} />
        <FormFieldList
          questions={pager.page.questions}
          values={answers}
          onChange={set}
          renderField={(q) =>
            q.type === "file" ? (
              <div className="text-xs text-muted-foreground italic border border-dashed border-border rounded-md px-3 py-2">
                File uploads aren’t available here.
              </div>
            ) : (
              <FormQuestionField
                question={q}
                value={answers[q.key] ?? ""}
                onChange={(v) => set(q.key, v)}
              />
            )
          }
        />

        <FormPagerNav
          pager={pager}
          getValue={(q) => answers[q.key]}
          onInvalid={(q) => setError(`"${q.data.label}" is required.`)}
          onAdvance={() => setError(null)}
          submitSlot={
            <Button
              type="submit"
              variant="primary"
              size="sm"
              disabled={state === "submitting"}
              className="self-start"
            >
              {state === "submitting" ? "Submitting…" : "Submit"}
            </Button>
          }
        />
      </form>
    </>
  );
}

// The branded card chrome both routes wrap the form in. This route renders
// outside the app layout, so on the desktop shell (a bare WKWebView with no
// browser back button) `allowExit` adds a Back control — otherwise the form is
// a dead end with no way out. Web keeps its own browser chrome; onboarding
// opts out entirely.
export function MemberFormShell({
  children,
  allowExit = false,
}: {
  children: React.ReactNode;
  allowExit?: boolean;
}) {
  const navigate = useNavigate();
  const [isDesktop, setIsDesktop] = useState(false);
  useEffect(() => {
    setIsDesktop(desktopVersion() !== null);
  }, []);

  const exit = () => {
    if (typeof window !== "undefined" && window.history.length > 1) {
      navigate(-1);
    } else {
      navigate("/");
    }
  };

  return (
    <div className="min-h-screen bg-section-bg p-4 sm:p-8 pt-10 sm:pt-16">
      <div className="mx-auto max-w-2xl bg-card border border-border shadow-brand-1 rounded-xl p-6 sm:p-8">
        <div className="flex items-center gap-2 mb-6">
          {allowExit && isDesktop && (
            <button
              type="button"
              onClick={exit}
              aria-label="Back"
              className="-ml-1 mr-1 flex items-center justify-center rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-muted"
            >
              <ChevronLeft className="w-[18px] h-[18px]" />
            </button>
          )}
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
