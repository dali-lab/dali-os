import { useCallback, useEffect, useId, useRef, useState } from "react";
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
  /** Short prompt asking the user to click the highlighted thing. */
  cta: React.ReactNode;
  /** Shown after the user lands on the matching page. */
  arrived: React.ReactNode;
  /** True if the iframe-reported URL means this step is satisfied. */
  matches: (pathname: string) => boolean;
  /** Locates the sidebar element to highlight, or null if not in DOM. */
  findTarget: () => HTMLElement | null;
};

function findInSidebar(predicate: (el: HTMLButtonElement) => boolean): HTMLElement | null {
  // Look in both desktop sidebar (<aside>) and the mobile nav panel. We can't
  // use offsetParent to detect hidden containers — the desktop sidebar is
  // position:fixed, which reports offsetParent === null even when visible.
  // getBoundingClientRect's size is the reliable signal: display:none → 0×0,
  // anything actually laid out → non-zero.
  const containers = Array.from(
    document.querySelectorAll<HTMLElement>("aside, #mobile-nav-panel"),
  );
  for (const c of containers) {
    const r = c.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
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
        Open <strong>Projects</strong> from the sidebar.
      </>
    ),
    arrived: <>Everything the lab is working on.</>,
    matches: (p) => p.startsWith("/projects"),
    findTarget: () => findByExactText("Projects"),
  },
  {
    icon: <CalendarDays className="w-4 h-4" />,
    cta: (
      <>
        Now try <strong>Calendar</strong>.
      </>
    ),
    arrived: <>Lab meetings, deadlines, social stuff.</>,
    matches: (p) => p.startsWith("/calendar"),
    findTarget: () => findByExactText("Calendar"),
  },
  {
    icon: <UserCircle2 className="w-4 h-4" />,
    cta: (
      <>
        Last one. Click your <strong>profile</strong> at the bottom of the
        sidebar.
      </>
    ),
    arrived: <>Drop a photo in. It&apos;s how the rest of the lab sees you.</>,
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

/**
 * Tracks a target element's bounding rect, polling on resize/scroll plus a
 * cheap interval so transitions (sidebar collapse, mobile drawer) stay glued.
 */
function useTargetRect(target: HTMLElement | null): DOMRect | null {
  const [rect, setRect] = useState<DOMRect | null>(() =>
    target ? target.getBoundingClientRect() : null,
  );
  useEffect(() => {
    if (!target) {
      setRect(null);
      return;
    }
    let alive = true;
    function measure() {
      if (!alive || !target) return;
      setRect(target.getBoundingClientRect());
    }
    measure();
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
  return rect;
}

/** Pulsing coral ring positioned around an element. No dim. */
function PulseRing({ target, zIndex }: { target: HTMLElement; zIndex: number }) {
  const rect = useTargetRect(target);
  if (!rect) return null;
  const PAD = 6;
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed rounded-md launch-tour-pulse"
      style={{
        top: rect.top - PAD,
        left: rect.left - PAD,
        width: rect.width + PAD * 2,
        height: rect.height + PAD * 2,
        zIndex,
      }}
    />
  );
}

/** Full spotlight: dims the page everywhere except a cut-out over `target`,
 *  with a pulsing ring on top. */
function Spotlight({ target }: { target: HTMLElement }) {
  const rect = useTargetRect(target);
  if (!rect) return null;
  const PAD = 6;
  const box = {
    top: rect.top - PAD,
    left: rect.left - PAD,
    width: rect.width + PAD * 2,
    height: rect.height + PAD * 2,
  };
  return (
    <>
      {/* Cut-out: transparent rect with huge outward box-shadow dims the rest
          of the page. pointer-events: none so clicks pass through. */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed z-40 rounded-md"
        style={{ ...box, boxShadow: "0 0 0 9999px rgba(0, 0, 0, 0.55)" }}
      />
      <PulseRing target={target} zIndex={41} />
    </>
  );
}

export function LaunchWelcome({ firstName }: { firstName: string }) {
  const [phase, setPhase] = useState<Phase>("done");
  const [step, setStep] = useState(0);
  const [arrived, setArrived] = useState(false);
  const [sidebarTarget, setSidebarTarget] = useState<HTMLElement | null>(null);
  const nextButtonRef = useRef<HTMLButtonElement | null>(null);
  const [nextTarget, setNextTarget] = useState<HTMLElement | null>(null);
  const titleId = useId();

  useEffect(() => {
    setPhase(readPhase());
    setStep(readStep());
  }, []);

  // Re-resolve the sidebar highlight target whenever the active step changes.
  // Cheap interval because the sidebar may not be present at mount time.
  useEffect(() => {
    if (phase !== "card") return;
    if (step >= STEPS.length) return;
    if (arrived) {
      setSidebarTarget(null);
      return;
    }
    const find = STEPS[step].findTarget;
    function resolve() {
      setSidebarTarget(find());
    }
    resolve();
    const id = window.setInterval(resolve, 300);
    return () => window.clearInterval(id);
  }, [phase, step, arrived]);

  // After arriving, point the next-button ref into local state so PulseRing
  // re-renders against a stable element. (Refs alone don't trigger re-renders.)
  useEffect(() => {
    setNextTarget(arrived ? nextButtonRef.current : null);
  }, [arrived, step]);

  // Listen for iframe-reported tab navigation — that's how the workspace
  // signals "the user is now looking at X". Sidebar clicks open iframe tabs,
  // so useLocation on the parent shell never fires.
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
              DALI OS is live
            </h2>
            <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
              Hi {firstName}. The new site is up. Want a quick spin around it?
            </p>
          </div>
          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={finishTour}
              className="text-sm text-muted-foreground hover:text-foreground px-3 py-2"
            >
              Not now
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

      {/* Sidebar spotlight before they click. */}
      {sidebarTarget && !arrived && !isFinal && <Spotlight target={sidebarTarget} />}

      {/* Next-button ring after they arrive (no dim — card is already prominent). */}
      {nextTarget && arrived && !isFinal && (
        <PulseRing target={nextTarget} zIndex={60} />
      )}

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
                That&apos;s the tour. There&apos;s a launch party on the
                calendar. Come celebrate.
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
                Sounds good
              </button>
            ) : arrived ? (
              <button
                ref={nextButtonRef}
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
                  I&apos;m there
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
