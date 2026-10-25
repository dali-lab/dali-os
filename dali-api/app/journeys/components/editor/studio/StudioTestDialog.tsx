import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { GraduationCap } from "lucide-react";
import { buttonClasses } from "~/components/ui/Button";
import { initialWork } from "~/journeys/lib/studio";
import type { StudioLab, StudioWork, SubmissionStatus } from "~/journeys/lib/studio-types";
import { StudioLabView } from "~/journeys/components/studio/StudioLabView";

/** The learner experience with throwaway state, plus a button that plays the mentor's part. */
function TestSession({ studio, onClose }: { studio: StudioLab; onClose: () => void }) {
  const [work, setWork] = useState<StudioWork>(() => initialWork(studio));
  const [selfChecks, setSelfChecks] = useState<Record<string, boolean>>({});
  const [status, setStatus] = useState<SubmissionStatus>("in-progress");
  const [workKey, setWorkKey] = useState(0);

  return (
    <StudioLabView
      studio={studio}
      title={`Testing: ${studio.title || "Untitled lab"}`}
      subtitle="This is what learners see. Nothing here is saved."
      work={work}
      onWorkChange={(fn) => setWork(fn)}
      selfChecks={selfChecks}
      onToggleSelf={(id) => setSelfChecks((s) => ({ ...s, [id]: !s[id] }))}
      status={status}
      mentorChecks={{}}
      mentorNote={status === "approved" ? "Simulated approval from the lab editor." : undefined}
      isCompleted={false}
      onSubmit={() => setStatus("submitted")}
      onComplete={onClose}
      completeLabel="Everything passes, close"
      onReset={() => {
        setWork(initialWork(studio));
        setSelfChecks({});
        setStatus("in-progress");
        setWorkKey((k) => k + 1);
      }}
      workKey={workKey}
      onExit={onClose}
      exitLabel="Close test"
      extraAction={
        status === "submitted" ? (
          <button type="button" onClick={() => setStatus("approved")} className={buttonClasses("secondary", "sm")}>
            <GraduationCap className="h-3.5 w-3.5" aria-hidden />
            Simulate approval
          </button>
        ) : undefined
      }
    />
  );
}

export function StudioTestDialog({ open, studio, onClose }: { open: boolean; studio: StudioLab; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    // On document, ahead of the lab editor's window listener, so Escape closes only the test.
    const onKey = (e: KeyboardEvent) => {
      const inside = e.target instanceof Node && ref.current?.contains(e.target);
      if (e.key === "Escape" && !e.defaultPrevented && (inside || e.target === document.body)) {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div ref={ref} role="dialog" aria-modal="true" aria-label={`Testing ${studio.title}`} className="fixed inset-0 z-[46] bg-os-bg font-os text-foreground">
      <TestSession studio={studio} onClose={onClose} />
    </div>,
    document.body,
  );
}
