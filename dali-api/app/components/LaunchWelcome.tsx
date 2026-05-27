import { useCallback, useEffect, useId, useState } from "react";
import {
  Sparkles,
  PartyPopper,
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
  /** Short, action-oriented prompt. */
  cta: React.ReactNode;
  /** Confirmation shown once the user lands on the matched page. */
  arrived: React.ReactNode;
  /** True if the iframe-reported URL means this step is satisfied. */
  matches: (pathname: string) => boolean;
  /** Locates the sidebar element to highlight, or null if not currently in DOM. */
  findTarget: () => HTMLElement | null;
};

function findInSidebar(predicate: (el: HTMLButtonElement) => boolean): HTMLElement | null {
  // Look in both desktop sidebar (<aside>) and the mobile nav panel.
  const containers = Array.from(
    document.querySelectorAll<HTMLElement>("aside, #mobile-nav-panel"),
  );
  for (const c of containers) {
    if (c.offsetParent === null) continue; // skip hidden (mobile panel closed)
    const buttons = c.querySelectorAll<HTMLButtonElement>("button");
    for (const btn of buttons) {
      if (predicate(btn)) return btn;
    }
  }
  return null;
}

function findByExactText(text: string) {
  return findInSidebar((btn) => (btn.textContent || "").trim() === text);
}

const STEPS: TourStep[] = [
  {
    icon: <FolderKanban className="w-4 h-4" />,
    cta: (
      <>
        Click <strong>Projects</strong> in the sidebar to see every active
        project.
      </>
    ),
    arrived: <>Nice — every active project lives here.</>,
    matches: (p) => p.startsWith("/projects"),
    findTarget: () => findByExactText("Projects"),
  },
  {
    icon: <CalendarDays className="w-4 h-4" />,
    cta: (
      <>
        Now click <strong>Calendar</strong> to see lab meetings and events.
      </>
    ),
    arrived: <>Lab meetings, standups, and your own events — all in lab time.</>,
    matches: (p) => p.startsWith("/calendar"),
    findTarget: () => findByExactText("Calendar"),
  },
  {
    icon: <UserCircle2 className="w-4 h-4" />,
    cta: (
      <>
        Last one — click your <strong>profile</strong> (bottom of the sidebar)
        to make it yours.
      </>
    ),
    arrived: (
      <>
        Add a photo and a few words — this is how the lab gets to know you.
      </>
    ),
    matches: (p) => p.startsWith("/profile"),
    findTarget: () =>
      findInSidebar((btn) => btn.getAttribute("aria-label") === "Open profile"),
  },
];

function readPhase(): Phase {
  try {
    if (window.localStorage.getItem(DONE_KEY)) return "done";
    if (window.localStorage.getItem(STEP_KEY) !== null) return "card";
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

function SpotlightRing({ target }: { target: HTMLElement }) {
  const [rect, setRect] = useState<DOMRect | null>(() => target.getBoundingClientRect());

  useEffect(() => {
    let alive = true;
    function measure() {
      if (!alive) return;
      setRect(target.getBoundingClientRect());
    }
    measure();
    // Sidebar can collapse, page can scroll, mobile drawer can open — poll
    // cheaply so the ring stays glued to the element. Throwaway tour code,
    // a 150ms tick is plenty smooth.
    const id = window.setInterval(measure, 150);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      alive = false;
      window.clearInterval(id);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [target]);

  if (!rect) return null;
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed z-50 rounded-md launch-tour-pulse"
      style={{
        top: rect.top - 4,
        left: rect.left - 4,
        width: rect.width + 8,
        height: rect.height + 8,
      }}
    />
  );
}

export function LaunchWelcome({ firstName }: { firstName: string }) {
  const [phase, setPhase] = useState<Phase>("done");
  const [step, setStep] = useState(0);
  const [arrived, setArrived] = useState(false);
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const titleId = useId();

  useEffect(() => {
    setPhase(readPhase());
    setStep(readStep());
  }, []);

  // Re-resolve the highlight target whenever the active step changes or the
  // sidebar DOM might have shifted (mobile drawer open/close). Cheap interval
  // because the sidebar isn't always present at mount time.
  useEffect(() => {
    if (phase !== "card") return;
    if (step >= STEPS.length) return;
    if (arrived) {
      setTarget(null);
      return;
    }
    const find = STEPS[step].findTarget;
    function resolve() {
      const el = find();
      setTarget(el);
    }
    resolve();
    const id = window.setInterval(resolve, 300);
    return () => window.clearInterval(id);
  }, [phase, step, arrived]);

  // Listen for iframe-reported tab navigation — that's how the workspace
  // signals "the user is now looking at X". Falls back to top-level pathname
  // for routes that aren't tab-wrapped.
  const handleUrl = useCallback(
    (url: string) => {
      if (phase !== "card") return;
      if (arrived) return;
      if (step >= STEPS.length) return;
      try {
        const path = new URL(url, window.location.origin).pathname;
        if (STEPS[step].matches(path)) setArrived(true);
      } catch {
        // Bad URL — ignore.
      }
    },
    [phase, step, arrived],
  );

  useEffect(() => {
    function onMsg(e: MessageEvent) {
      if (e.origin !== window.location.origin) return;
      const d = e.data;
      if (!d || d.type !== "dali:tabNavigated" || typeof d.url !== "string") return;
      handleUrl(d.url);
    }
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [handleUrl]);

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

  const isFinal = step >= STEPS.length;
  const current = isFinal ? null : STEPS[step];

  return (
    <>
      {/* CSS keyframes for the spotlight pulse. Scoped to this component via
          the .launch-tour-pulse class so removal = delete file. */}
      <style>{`
        @keyframes launch-tour-pulse {
          0%, 100% {
            box-shadow:
              0 0 0 2px rgba(255, 139, 129, 0.95),
              0 0 0 6px rgba(255, 139, 129, 0.35),
              0 0 16px 4px rgba(255, 139, 129, 0.35);
          }
          50% {
            box-shadow:
              0 0 0 2px rgba(255, 139, 129, 0.95),
              0 0 0 10px rgba(255, 139, 129, 0),
              0 0 24px 8px rgba(255, 139, 129, 0);
          }
        }
        .launch-tour-pulse {
          animation: launch-tour-pulse 1.6s ease-in-out infinite;
        }
      `}</style>

      {target && !arrived && !isFinal && <SpotlightRing target={target} />}

      <div className="fixed bottom-4 right-4 z-50 w-80 max-w-[calc(100vw-2rem)] pointer-events-auto">
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

          <div className="flex items-center gap-1.5" aria-hidden="true">
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
              <>
                <button
                  type="button"
                  onClick={finishTour}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  Skip tour
                </button>
                <button
                  type="button"
                  onClick={() => setArrived(true)}
                  className="text-xs text-muted-foreground hover:text-foreground"
                  title="Skip this step"
                >
                  I'm there →
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
