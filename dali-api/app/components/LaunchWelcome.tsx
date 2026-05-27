import { useEffect, useId, useState } from "react";
import { useLocation } from "react-router";
import {
  Sparkles,
  PartyPopper,
  Home,
  FolderKanban,
  CalendarDays,
  UserCircle2,
  ArrowRight,
  X as XIcon,
  Check,
} from "lucide-react";
import { Modal } from "./Modal";

const DONE_KEY = "dalios-launch-welcome-seen-v1";
const STEP_KEY = "dalios-launch-tour-step-v1";

type Phase = "modal" | "card" | "done";

type TourStep = {
  icon: React.ReactNode;
  /** What the user should do next — short, action-oriented. */
  cta: React.ReactNode;
  /** Path that, when visited, advances the tour. */
  match: (pathname: string) => boolean;
  /** Confirmation message once they land on the matched page. */
  arrived: React.ReactNode;
};

const STEPS: TourStep[] = [
  {
    icon: <Home className="w-4 h-4" />,
    cta: (
      <>
        Click <strong>Home</strong> in the sidebar to see your week at a glance.
      </>
    ),
    match: (p) => p === "/",
    arrived: (
      <>
        This is home — tasks, meeting invites, and the lab's week all live
        here.
      </>
    ),
  },
  {
    icon: <FolderKanban className="w-4 h-4" />,
    cta: (
      <>
        Now click <strong>Hub</strong> under Projects to browse every active
        project.
      </>
    ),
    match: (p) => p.startsWith("/projects"),
    arrived: <>Nice — every active project lives here.</>,
  },
  {
    icon: <CalendarDays className="w-4 h-4" />,
    cta: (
      <>
        Next, click <strong>Calendar</strong> to see lab meetings and events.
      </>
    ),
    match: (p) => p.startsWith("/calendar"),
    arrived: <>Lab meetings, standups, and your own events — all in lab time.</>,
  },
  {
    icon: <UserCircle2 className="w-4 h-4" />,
    cta: (
      <>
        Almost done — click your <strong>profile</strong> (top of the sidebar)
        to make it yours.
      </>
    ),
    match: (p) => p.startsWith("/profile"),
    arrived: (
      <>
        Add a photo and a few words — this is how the lab gets to know you.
      </>
    ),
  },
];

function readPhase(): Phase {
  try {
    if (window.localStorage.getItem(DONE_KEY)) return "done";
    const raw = window.localStorage.getItem(STEP_KEY);
    if (raw !== null) return "card";
  } catch {
    return "done";
  }
  return "modal";
}

function readStep(): number {
  try {
    const raw = window.localStorage.getItem(STEP_KEY);
    if (raw === null) return 0;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) ? Math.max(0, Math.min(STEPS.length, n)) : 0;
  } catch {
    return 0;
  }
}

export function LaunchWelcome({ firstName }: { firstName: string }) {
  const [phase, setPhase] = useState<Phase>("done");
  const [step, setStep] = useState(0);
  const [arrived, setArrived] = useState(false);
  const titleId = useId();
  const location = useLocation();

  useEffect(() => {
    setPhase(readPhase());
    setStep(readStep());
  }, []);

  // Advance the floating card when the user reaches the step's target page.
  // Show a brief "arrived" confirmation before moving on to the next CTA.
  useEffect(() => {
    if (phase !== "card") return;
    if (step >= STEPS.length) return;
    if (arrived) return;
    if (STEPS[step].match(location.pathname)) {
      setArrived(true);
    }
  }, [phase, step, arrived, location.pathname]);

  function startTour() {
    try {
      window.localStorage.setItem(STEP_KEY, "0");
    } catch {
      // ignore
    }
    setStep(0);
    setArrived(false);
    setPhase("card");
  }

  function finishTour() {
    try {
      window.localStorage.setItem(DONE_KEY, new Date().toISOString());
      window.localStorage.removeItem(STEP_KEY);
    } catch {
      // ignore
    }
    setPhase("done");
  }

  function advance() {
    const next = step + 1;
    try {
      window.localStorage.setItem(STEP_KEY, String(next));
    } catch {
      // ignore
    }
    setStep(next);
    setArrived(false);
  }

  if (phase === "done") return null;

  if (phase === "modal") {
    return (
      <Modal open onClose={finishTour} labelledBy={titleId}>
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <span className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-accent-coral">
              <Sparkles className="w-4 h-4" />
              Welcome
            </span>
            <button
              type="button"
              onClick={finishTour}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Skip
            </button>
          </div>
          <div>
            <h2
              id={titleId}
              className="font-heading text-xl font-bold text-foreground"
            >
              Hey {firstName} — welcome to DALIos
            </h2>
            <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
              This is the new home for everything DALI. Want a quick tour? We'll
              point you at a few spots in the sidebar — click as you go.
            </p>
          </div>
          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={finishTour}
              className="text-sm text-muted-foreground hover:text-foreground px-3 py-2"
            >
              Maybe later
            </button>
            <button
              type="button"
              onClick={startTour}
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent-coral px-4 py-2 text-sm font-semibold text-white hover:bg-accent-coral/90"
            >
              Show me around
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </Modal>
    );
  }

  // phase === "card" — floating coach card in bottom-right.
  const isFinal = step >= STEPS.length;
  const current = isFinal ? null : STEPS[step];

  return (
    <div className="fixed bottom-4 right-4 z-40 w-80 max-w-[calc(100vw-2rem)] pointer-events-auto">
      <div className="bg-card border border-border rounded-2xl shadow-brand-2 p-4 flex flex-col gap-3">
        <div className="flex items-start justify-between gap-2">
          <span className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-accent-coral">
            {isFinal ? (
              <PartyPopper className="w-4 h-4" />
            ) : arrived ? (
              <Check className="w-4 h-4" />
            ) : (
              current!.icon
            )}
            {isFinal
              ? "Launch party"
              : arrived
                ? "You're here"
                : `Step ${step + 1} of ${STEPS.length}`}
          </span>
          <button
            type="button"
            onClick={finishTour}
            className="text-muted-foreground hover:text-foreground -mt-1 -mr-1 p-1"
            aria-label="Dismiss tour"
          >
            <XIcon className="w-4 h-4" />
          </button>
        </div>

        <p className="text-sm text-foreground leading-relaxed">
          {isFinal ? (
            <>
              That's the tour! 🎉 The site launch party is right around the
              corner — keep an eye on the calendar for the invite.
            </>
          ) : arrived ? (
            current!.arrived
          ) : (
            current!.cta
          )}
        </p>

        <div
          className="flex items-center gap-1.5"
          aria-hidden="true"
        >
          {STEPS.map((_, i) => (
            <span
              key={i}
              className={
                "h-1 rounded-full flex-1 " +
                (i < step || (i === step && arrived) || isFinal
                  ? "bg-accent-coral"
                  : "bg-muted-foreground/20")
              }
            />
          ))}
        </div>

        <div className="flex items-center justify-end gap-2 pt-1">
          {isFinal ? (
            <button
              type="button"
              onClick={finishTour}
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent-coral px-3 py-1.5 text-sm font-semibold text-white hover:bg-accent-coral/90"
            >
              Let's go
            </button>
          ) : arrived ? (
            <button
              type="button"
              onClick={advance}
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent-coral px-3 py-1.5 text-sm font-semibold text-white hover:bg-accent-coral/90"
            >
              Next
              <ArrowRight className="w-4 h-4" />
            </button>
          ) : (
            <button
              type="button"
              onClick={finishTour}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Skip tour
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
