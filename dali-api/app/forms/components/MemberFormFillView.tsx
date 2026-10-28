import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
import {
  FormTileStrip,
  TILE_MOTION,
  type TileStripPhase,
} from "~/forms/components/FormTileStrip";
import { stripPattern } from "~/forms/lib/tile-strip";
import { canAnimate, prefersReducedMotion } from "~/components/meeting-recorder/motion";
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

const SETTLE_EASE = "cubic-bezier(.23,1,.32,1)";

const motionOk = (el: Element | null): el is Element => canAnimate(el) && !prefersReducedMotion();

export function MemberFormFillView({
  data,
  // Optional: rendered on the "Submitted" screen instead of the default copy.
  doneContent,
  // Optional extra fields merged into the submit body (e.g. the education
  // session/offering context the fill URL carried).
  extraBody,
  // Optional local path to return to after submitting — carried by the app-lock
  // gate so a required fill lands the member back where they were headed. Shown
  // as a "Continue" button on the done screen.
  next,
  // Seeds the tile strip; the form renders full-bleed inside a flush shell.
  tileSeed,
  allowExit = false,
}: {
  data: MemberFormData;
  doneContent?: React.ReactNode;
  extraBody?: Record<string, string | null>;
  next?: string | null;
  tileSeed?: string | null;
  allowExit?: boolean;
}) {
  const navigate = useNavigate();
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [state, setState] = useState<"idle" | "submitting" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  const questions = data.questions;
  const pages = useMemo(() => paginateQuestions(questions), [questions]);
  const pager = useFormPager(pages, { excludeFileType: true });

  const tiles = useMemo(() => (tileSeed ? stripPattern(tileSeed) : null), [tileSeed]);
  const [tilePhase, setTilePhase] = useState<TileStripPhase>("idle");
  const rootRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLDivElement>(null);
  const doneRef = useRef<HTMLDivElement>(null);
  const fade = useRef<Animation | null>(null);
  const heightBeforeSettle = useRef<number | null>(null);

  useEffect(() => {
    if (tiles && state === "done" && tilePhase === "folded") {
      heightBeforeSettle.current = rootRef.current?.offsetHeight ?? null;
      setTilePhase("settled");
    }
  }, [tiles, state, tilePhase]);

  useLayoutEffect(() => {
    if (tilePhase !== "settled") return;
    const root = rootRef.current;
    const from = heightBeforeSettle.current;
    if (!motionOk(root) || from === null) return;
    const timing = { duration: TILE_MOTION.settle, easing: SETTLE_EASE };
    root.animate([{ height: `${from}px` }, { height: `${root.offsetHeight}px` }], timing);
    doneRef.current?.animate(
      [{ opacity: 0, transform: "translateY(8px)" }, { opacity: 1, transform: "none" }],
      { ...timing, delay: TILE_MOTION.settle / 4, fill: "backwards" },
    );
  }, [tilePhase]);

  function set(key: string, v: string) {
    setAnswers((a) => ({ ...a, [key]: v }));
  }

  function startFold() {
    setTilePhase("folding");
    const el = formRef.current;
    if (!motionOk(el)) return;
    fade.current = el.animate([{ opacity: 1 }, { opacity: 0 }], {
      duration: TILE_MOTION.fade,
      delay: TILE_MOTION.fadeDelay,
      easing: "ease-out",
      fill: "forwards",
    });
  }

  function failSubmit(message: string) {
    setError(message);
    setState("idle");
    if (!tiles) return;
    fade.current?.cancel();
    fade.current = null;
    setTilePhase("idle");
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
    if (tiles) startFold();
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
        failSubmit(out.error ?? `Submission failed (${res.status}).`);
        return;
      }
      setState("done");
    } catch {
      failSubmit("Network error — please try again.");
    }
  }

  const continueButton = next && (
    <div className="mt-6">
      <Button variant="primary" size="sm" onClick={() => navigate(next)}>
        Continue
      </Button>
    </div>
  );

  if (state === "done" && !tiles) {
    return (
      <div className="text-center py-10">
        {doneContent ?? (
          <>
            <h1 className="font-heading text-xl font-bold text-foreground">
              Submitted
            </h1>
            <p className="text-sm text-muted-foreground mt-2">
              Your response to “{data.name}” has been recorded.
            </p>
          </>
        )}
        {continueButton}
      </div>
    );
  }

  const formBody = (
    <>
      <h1 className="font-heading text-2xl font-bold text-foreground">
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

  if (!tiles) return formBody;

  return (
    <div ref={rootRef} className="overflow-hidden">
      <FormTileStrip cells={tiles} phase={tilePhase} onFolded={() => setTilePhase("folded")} />
      {tilePhase === "settled" ? (
        <div ref={doneRef} className="p-5 sm:p-8">
          {doneContent ?? (
            <>
              <h1 className="font-heading text-2xl font-bold text-foreground">
                Thanks for submitting!
              </h1>
              <p className="text-sm text-muted-foreground mt-2">
                Your response to “{data.name}” has been recorded.
              </p>
            </>
          )}
          {continueButton}
        </div>
      ) : (
        <div ref={formRef} className="p-5 sm:p-8">
          <div className="flex items-center gap-2 mb-5">
            {allowExit && <FormExitButton />}
            <span className="font-os-logo text-[15px] font-semibold text-os-accent">dali.os</span>
          </div>
          {formBody}
        </div>
      )}
    </div>
  );
}

// This route renders outside the app layout, so on the desktop shell (a bare
// WKWebView with no browser back button) the form would otherwise be a dead
// end. Web keeps its own browser chrome.
export function FormExitButton() {
  const navigate = useNavigate();
  const [isDesktop, setIsDesktop] = useState(false);
  useEffect(() => {
    setIsDesktop(desktopVersion() !== null);
  }, []);

  if (!isDesktop) return null;

  const exit = () => {
    if (typeof window !== "undefined" && window.history.length > 1) {
      navigate(-1);
    } else {
      navigate("/");
    }
  };

  return (
    <button
      type="button"
      onClick={exit}
      aria-label="Back"
      className="-ml-1 mr-1 flex items-center justify-center rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-muted"
    >
      <ChevronLeft className="w-[18px] h-[18px]" />
    </button>
  );
}

// The branded card chrome both routes wrap the form in. Onboarding opts out of
// the Back control. `flush` drops the padding and brand row for a child that
// draws its own (the tile strip runs edge to edge).
export function MemberFormShell({
  children,
  allowExit = false,
  flush = false,
}: {
  children: React.ReactNode;
  allowExit?: boolean;
  flush?: boolean;
}) {
  return (
    <div className="min-h-screen bg-section-bg p-4 sm:p-8 pt-10 sm:pt-16">
      <div
        className={
          flush
            ? "mx-auto max-w-2xl bg-card border border-border rounded-os-card overflow-hidden"
            : "mx-auto max-w-2xl bg-card border border-border rounded-os-card p-5 sm:p-8"
        }
      >
        {!flush && (
          <div className="flex items-center gap-2 mb-6">
            {allowExit && <FormExitButton />}
            <div className="w-7 h-7 bg-os-accent rounded-md flex items-center justify-center">
              <span className="text-white font-bold text-base leading-none font-heading">
                D
              </span>
            </div>
            <span className="font-heading text-sm font-bold text-foreground">
              DALI OS
            </span>
          </div>
        )}
        {children}
      </div>
    </div>
  );
}
