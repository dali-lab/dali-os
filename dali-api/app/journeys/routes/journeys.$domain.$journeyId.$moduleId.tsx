import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, redirect, useFetcher, useNavigate, useSearchParams } from "react-router";
import { CheckCircle2, FlaskConical, Lock } from "lucide-react";
import type { Route } from "./+types/journeys.$domain.$journeyId.$moduleId";
import { buttonClasses } from "~/components/ui/Button";
import { useToast } from "~/components/ui/toast";
import { CompletionDialog } from "~/journeys/components/CompletionDialog";
import { LessonView } from "~/journeys/components/LessonView";
import { ModuleOutline, type ModuleView } from "~/journeys/components/ModuleOutline";
import { StatusChip } from "~/journeys/components/StatusChip";
import { BackLink } from "~/journeys/components/BackLink";
import { LabIDE } from "~/journeys/components/lab/LabIDE";
import { LearnerStudioLab } from "~/journeys/components/studio/LearnerStudioLab";
import { QuizView } from "~/journeys/components/quiz/QuizView";
import { SlideViewer } from "~/components/slides/SlideViewer";
import { findDomain, loadLearnerJourney, requireJourneyViewer, toDomain } from "~/journeys/lib/journeys.server";
import { progressAction } from "~/journeys/lib/progress-action.server";
import { loadMySubmission } from "~/journeys/lib/studio.server";
import {
  activityKey,
  getModule,
  getModuleStatus,
  hasLab,
  getNewlyUnlocked,
  journeyTitle,
  moduleTitle,
  type ActivityKind,
} from "~/journeys/lib/journey";
import { domainPath, journeyPath, JOURNEYS_HOME } from "~/journeys/lib/paths";
import type { JourneyModule } from "~/journeys/lib/types";

export const meta: Route.MetaFunction = ({ data }) => [
  { title: `${data ? moduleTitle(data.module) : "Module"} · DALI OS` },
];

export const handle = { fitViewport: true, hideBreadcrumbs: true };

export async function loader({ request, params }: Route.LoaderArgs) {
  const viewer = await requireJourneyViewer(request);
  const domain = await findDomain(params.domain);
  if (!domain) throw redirect(JOURNEYS_HOME);
  const slug = toDomain(domain).slug;
  const found = await loadLearnerJourney(viewer, domain.id, params.journeyId);
  if (!found) throw redirect(domainPath(slug));
  const mod = getModule(found.journey, params.moduleId);
  if (!mod) throw redirect(journeyPath(slug, found.journey.id));
  const submission = mod.studio ? await loadMySubmission(viewer, found.journey.id, mod.id) : null;
  return { domain: toDomain(domain), ...found, module: mod, submission };
}

export async function action({ request, params }: Route.ActionArgs) {
  const viewer = await requireJourneyViewer(request);
  return progressAction(request, viewer, params.journeyId);
}

function useProgressWriter(serverKeys: string[]) {
  const fetcher = useFetcher<{ ok: boolean; error?: string }>();
  const toast = useToast();
  // Keys sent but not yet reflected by the loader, so the page moves on at once.
  const [pending, setPending] = useState<string[]>([]);
  useEffect(() => setPending([]), [serverKeys]);
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data && !fetcher.data.ok) {
      toast.error(fetcher.data.error ?? "Your progress didn't save. Try again.");
      setPending([]);
    }
  }, [fetcher.state, fetcher.data, toast]);

  const completed = useMemo(() => new Set([...serverKeys, ...pending]), [serverKeys, pending]);
  const record = useCallback(
    (keys: string[]) => {
      setPending((p) => [...p, ...keys]);
      const form = new FormData();
      form.set("intent", "complete");
      for (const k of keys) form.append("key", k);
      fetcher.submit(form, { method: "post" });
    },
    [fetcher],
  );
  return { completed, record, saving: fetcher.state !== "idle" };
}

export default function ModuleDetail({ loaderData }: Route.ComponentProps) {
  const { domain, journey, module: mod, started, completed: serverKeys, submission } = loaderData;
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { completed, record, saving } = useProgressWriter(serverKeys);
  const [unlocked, setUnlocked] = useState<JourneyModule[] | null>(null);
  useEffect(() => setUnlocked(null), [mod.id]);
  const closeDialog = useCallback(() => setUnlocked(null), []);

  const status = getModuleStatus(mod, completed);
  const basePath = journeyPath(domain.slug, journey.id);

  // Opening any unlocked module counts as starting the journey.
  const starter = useFetcher();
  const startedRef = useRef(started);
  useEffect(() => {
    if (startedRef.current || status === "locked") return;
    startedRef.current = true;
    starter.submit({ intent: "start" }, { method: "post" });
  }, [status, starter]);

  const isCompleted = status === "completed";
  const slides = mod.slides ?? [];
  const requested = params.get("view");
  const view: ModuleView =
    requested === "lab" && hasLab(mod)
      ? "lab"
      : requested === "quiz" && mod.quiz
        ? "quiz"
        : requested === "slides" && slides.length > 0
          ? "slides"
          : "lesson";
  const pageIndex = Math.min(Math.max(Number(params.get("page")) || 0, 0), Math.max(mod.pages.length - 1, 0));
  const slideIndex = Math.min(Math.max(Number(params.get("slide")) || 0, 0), Math.max(slides.length - 1, 0));
  const labKey = activityKey(mod.id, "lab");
  const quizKey = activityKey(mod.id, "quiz");
  const labDone = isCompleted || completed.has(labKey);
  const quizDone = isCompleted || completed.has(quizKey);

  const setView = (next: ModuleView) =>
    setParams((prev) => {
      const p = new URLSearchParams(prev);
      if (next === "lesson") p.delete("view");
      else p.set("view", next);
      if (next !== "slides") p.delete("slide");
      return p;
    });
  const setPage = (index: number) =>
    setParams((prev) => {
      const p = new URLSearchParams(prev);
      p.set("page", String(index));
      p.delete("view");
      return p;
    });
  const setSlide = (index: number) =>
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        p.set("view", "slides");
        p.set("slide", String(index));
        return p;
      },
      { replace: true },
    );

  const completeModule = (alsoRecord: string[] = []) => {
    const doneBefore = new Set([...completed, ...alsoRecord]);
    setUnlocked(getNewlyUnlocked(journey, mod.id, doneBefore));
    record([...alsoRecord, mod.id]);
  };

  /** Records a finished lab or quiz, then moves to whatever the module still needs. */
  const finishActivity = (kind: ActivityKind) => {
    const key = activityKey(mod.id, kind);
    if (isCompleted) {
      if (!completed.has(key)) record([key]);
      navigate(basePath);
      return;
    }
    const done = new Set(completed).add(key);
    if (hasLab(mod) && !done.has(labKey)) {
      record([key]);
      setView("lab");
    } else if (mod.quiz && !done.has(quizKey)) {
      record([key]);
      setView("quiz");
    } else {
      completeModule(completed.has(key) ? [] : [key]);
    }
  };

  const prerequisites = mod.dependsOn
    .map((id) => journey.modules.find((m) => m.id === id))
    .filter((m): m is JourneyModule => Boolean(m));
  const journeyDone = journey.modules.every((m) => m.id === mod.id || completed.has(m.id));
  const afterSlides = hasLab(mod)
    ? { label: "Open the lab", onClick: () => setView("lab") }
    : mod.quiz
      ? { label: "Take the quiz", onClick: () => setView("quiz") }
      : { label: "Back to lesson", onClick: () => setView("lesson") };

  const dialog = (
    <CompletionDialog
      open={unlocked !== null}
      moduleName={moduleTitle(mod)}
      basePath={basePath}
      unlocked={unlocked ?? []}
      journeyDone={journeyDone}
      onClose={closeDialog}
    />
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6">
      <header className="flex shrink-0 flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <BackLink to={basePath}>{journeyTitle(journey)}</BackLink>
          <div className="mt-2 flex min-w-0 items-center gap-3">
            <h1 className="truncate font-heading text-2xl font-semibold">{moduleTitle(mod)}</h1>
            <StatusChip status={status} />
          </div>
        </div>
        {hasLab(mod) && status !== "locked" && (
          <button type="button" onClick={() => setView("lab")} className={buttonClasses("secondary", "md")}>
            <FlaskConical className="h-4 w-4" aria-hidden />
            Open lab
          </button>
        )}
      </header>

      {status === "locked" ? (
        <div className="max-w-md">
          <Lock className="h-8 w-8 text-os-muted" aria-hidden />
          <h2 className="mt-4 font-heading text-2xl font-semibold">This module is locked</h2>
          <p className="mt-2 text-os-grey">It builds on earlier modules. Finish these first:</p>
          <ul className="mt-5 divide-y divide-os-container">
            {prerequisites.map((p) => (
              <li key={p.id}>
                <Link to={`${basePath}/${p.id}`} className="flex items-center gap-3 py-3 text-sm transition-colors hover:text-os-accent">
                  {completed.has(p.id) ? (
                    <CheckCircle2 className="h-4 w-4 text-os-green" aria-label="Completed" />
                  ) : (
                    <span className="h-4 w-4 rounded-full border-2 border-os-accent" aria-label="Not completed" />
                  )}
                  {moduleTitle(p)}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 gap-6 lg:grid-cols-[280px_minmax(0,1fr)] lg:gap-0">
          <ModuleOutline
            module={mod}
            view={view}
            pageIndex={pageIndex}
            labDone={labDone}
            quizDone={quizDone}
            onSelectPage={setPage}
            onOpen={(v) => (v === "slides" ? setSlide(0) : setView(v))}
          />
          {view === "slides" ? (
            <SlideViewer key={mod.id} slides={slides} index={slideIndex} onIndexChange={setSlide} finalAction={afterSlides} />
          ) : view === "quiz" && mod.quiz ? (
            <QuizView
              key={mod.id}
              quiz={mod.quiz}
              alreadyPassed={quizDone}
              continueLabel={isCompleted ? "Back to journey" : hasLab(mod) && !labDone ? "Continue to lab" : "Complete module"}
              onPassed={() => undefined}
              onContinue={() => finishActivity("quiz")}
            />
          ) : (
            <LessonView
              module={mod}
              backHref={basePath}
              pageIndex={pageIndex}
              isCompleted={isCompleted}
              completing={saving}
              onPageChange={setPage}
              onOpenLab={() => setView("lab")}
              onOpenQuiz={() => setView("quiz")}
              onComplete={() => completeModule()}
            />
          )}
        </div>
      )}

      {view === "lab" && hasLab(mod) && status !== "locked" && typeof document !== "undefined" &&
        createPortal(
          <div className="fixed inset-0 z-[45] bg-os-bg font-os text-foreground">
            {mod.studio ? (
              <LearnerStudioLab
                key={mod.id}
                studio={mod.studio}
                moduleId={mod.id}
                submission={submission}
                title={moduleTitle(mod)}
                subtitle={`${journeyTitle(journey)} · Lab`}
                isCompleted={labDone}
                onComplete={() => finishActivity("lab")}
                completeLabel={mod.quiz && !quizDone ? "Continue to quiz" : "Complete module"}
                onExit={() => setView("lesson")}
              />
            ) : (
              mod.lab && (
                <LabIDE
                  key={mod.id}
                  lab={mod.lab}
                  title={moduleTitle(mod)}
                  subtitle={`${journeyTitle(journey)} · Lab`}
                  isCompleted={labDone}
                  onComplete={() => finishActivity("lab")}
                  completeLabel={mod.quiz && !quizDone ? "Continue to quiz" : "Complete module"}
                  onExit={() => setView("lesson")}
                  exitLabel="Lesson"
                />
              )
            )}
          </div>,
          document.body,
        )}
      {dialog}
    </div>
  );
}
