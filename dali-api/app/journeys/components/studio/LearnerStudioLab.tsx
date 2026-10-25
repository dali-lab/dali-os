import { useCallback, useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";
import { useToast } from "~/components/ui/toast";
import { sameContent } from "~/journeys/lib/journey";
import { initialWork } from "~/journeys/lib/studio";
import type { LabSubmission } from "~/journeys/lib/studio.server";
import type { StudioLab, StudioWork, SubmissionStatus } from "~/journeys/lib/studio-types";
import { StudioLabView } from "./StudioLabView";

const SAVE_DELAY_MS = 800;

type ActionResult = { ok: boolean; error?: string };

/**
 * The learner's own whiteboard or document lab. Work autosaves to the module
 * route; submitting sends it to the journey's mentors, and the server re-runs
 * the checks before accepting it. In a preview nothing is sent, and
 * submitting approves at once since no mentor will review it.
 */
export function LearnerStudioLab({
  studio,
  moduleId,
  submission,
  preview = false,
  title,
  subtitle,
  isCompleted,
  onComplete,
  completeLabel,
  onExit,
}: {
  studio: StudioLab;
  moduleId: string;
  submission: LabSubmission | null;
  preview?: boolean;
  title: string;
  subtitle: string;
  isCompleted: boolean;
  onComplete: () => void;
  completeLabel: string;
  onExit: () => void;
}) {
  const toast = useToast();
  const saver = useFetcher<ActionResult>();
  const actor = useFetcher<ActionResult>();
  const [work, setWork] = useState<StudioWork>(() => submission?.work ?? initialWork(studio));
  const [selfChecks, setSelfChecks] = useState<Record<string, boolean>>(() => submission?.selfChecks ?? {});
  const [status, setStatus] = useState<SubmissionStatus>(submission?.status ?? "in-progress");
  const [workKey, setWorkKey] = useState(0);
  const savedWork = useRef<StudioWork>(work);
  const timer = useRef<number | undefined>(undefined);

  // A mentor's decision arrives through the loader; the learner's own edits never do.
  useEffect(() => {
    if (submission) setStatus(submission.status);
  }, [submission?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (saver.state === "idle" && saver.data && !saver.data.ok) toast.error(saver.data.error ?? "Your work didn't save. Try again.");
  }, [saver.state, saver.data, toast]);

  useEffect(() => {
    if (actor.state !== "idle" || !actor.data || actor.data.ok) return;
    toast.error(actor.data.error ?? "That didn't go through. Try again.");
    setStatus(submission?.status ?? "in-progress");
  }, [actor.state, actor.data, toast]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = useCallback(
    (fields: { work?: StudioWork; selfChecks?: Record<string, boolean> }) => {
      const form = new FormData();
      form.set("intent", "lab-save");
      form.set("moduleId", moduleId);
      if (fields.work) {
        form.set("work", JSON.stringify(fields.work));
        savedWork.current = fields.work;
      }
      if (preview) return;
      if (fields.selfChecks) form.set("selfChecks", JSON.stringify(fields.selfChecks));
      return saver.submit(form, { method: "post" });
    },
    [saver, moduleId, preview],
  );

  useEffect(() => {
    if (sameContent(work, savedWork.current)) return;
    timer.current = window.setTimeout(() => save({ work }), SAVE_DELAY_MS);
    return () => window.clearTimeout(timer.current);
  }, [work, save]);

  const toggleSelf = (id: string) => {
    const next = { ...selfChecks, [id]: !selfChecks[id] };
    setSelfChecks(next);
    save({ selfChecks: next });
  };

  const submit = async () => {
    window.clearTimeout(timer.current);
    await save({ work, selfChecks });
    if (preview) return setStatus("approved");
    setStatus("submitted");
    await actor.submit({ intent: "lab-submit", moduleId }, { method: "post" });
  };

  const reset = async () => {
    window.clearTimeout(timer.current);
    const start = initialWork(studio);
    savedWork.current = start;
    setWork(start);
    setSelfChecks({});
    setStatus("in-progress");
    setWorkKey((k) => k + 1);
    if (preview) return;
    await actor.submit({ intent: "lab-reset", moduleId }, { method: "post" });
  };

  // An approved lab still has to be finished; save any last edits first.
  const complete = async () => {
    window.clearTimeout(timer.current);
    if (!sameContent(work, savedWork.current)) await save({ work });
    onComplete();
  };

  return (
    <StudioLabView
      studio={studio}
      title={title}
      subtitle={subtitle}
      work={work}
      onWorkChange={(fn) => setWork(fn)}
      selfChecks={selfChecks}
      onToggleSelf={toggleSelf}
      status={status}
      mentorChecks={submission?.mentorChecks ?? {}}
      mentorNote={submission?.mentorNote}
      reviewerName={submission?.reviewerName}
      isCompleted={isCompleted}
      onSubmit={submit}
      onComplete={complete}
      completeLabel={completeLabel}
      onReset={reset}
      onExit={onExit}
      exitLabel="Lesson"
      workKey={workKey}
      busy={actor.state !== "idle"}
    />
  );
}
