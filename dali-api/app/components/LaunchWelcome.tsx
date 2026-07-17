import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useLocation } from "react-router";
import {
  PartyPopper,
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
  /** Short eyebrow label shown above the title on the card. */
  eyebrow: string;
  /** Step body — either a CTA to click a sidebar item or an info blurb. */
  cta: React.ReactNode;
  /** Confirmation shown after the user lands on the matched page. Required
   *  for click-driven steps; omitted for info-only steps. */
  arrived?: React.ReactNode;
  /** True if the iframe-reported URL means this step is satisfied. Omitted
   *  for info-only steps. */
  matches?: (pathname: string) => boolean;
  /** Locates the sidebar element to highlight. Omitted for info-only steps. */
  findTarget?: () => HTMLElement | null;
  /** Optional primary action shown alongside Next once the user has arrived
   *  on the matched page (e.g. "Connect Google Calendar"). Click runs onClick
   *  but does NOT advance — the user still hits Next to move on. */
  arrivedAction?: { label: string; onClick: () => void };
};

/** Walks up through any iframe ancestors so the rect is in the parent
 *  document's viewport coordinates (used by Spotlight on in-iframe targets). */
function getRectInParent(el: HTMLElement): DOMRect {
  let rect = el.getBoundingClientRect();
  let doc: Document | null = el.ownerDocument;
  while (doc && doc !== document) {
    const frame = doc.defaultView?.frameElement as HTMLIFrameElement | null;
    if (!frame) break;
    const frameRect = frame.getBoundingClientRect();
    rect = new DOMRect(
      rect.left + frameRect.left,
      rect.top + frameRect.top,
      rect.width,
      rect.height,
    );
    doc = frame.ownerDocument;
  }
  return rect;
}

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

// Two-step post-onboarding tour: walk a freshly-onboarded member through
// (1) linking their Google Calendar so the lab can see their availability,
// and (2) their profile page so they know where to update their details.
// Step 1 is omitted if the member already has a Google calendar linked, so
// a returning user who linked elsewhere only sees the profile step.
function buildSteps(opts: { hasCalendarLink: boolean }): TourStep[] {
  const steps: TourStep[] = [];

  if (!opts.hasCalendarLink) {
    steps.push({
      icon: <CalendarDays className="w-4 h-4" />,
      eyebrow: "Calendar",
      cta: (
        <>
          Open <strong>Calendar</strong> from the sidebar.
        </>
      ),
      arrived: (
        <>
          Connect your <strong>Google Calendar</strong> so the lab can see
          your availability for scheduling.
        </>
      ),
      matches: (p) => p.startsWith("/calendar"),
      findTarget: () => findByExactText("Calendar"),
      arrivedAction: {
        label: "Connect Google Calendar",
        onClick: () => {
          window.location.href = "/oauth/calendar/google/start";
        },
      },
    });
  }

  steps.push({
    icon: <UserCircle2 className="w-4 h-4" />,
    eyebrow: "Profile",
    cta: (
      <>
        Open your <strong>profile</strong> from the bottom of the sidebar.
      </>
    ),
    arrived: (
      <>
        Review your details and add anything that&apos;s missing — you can
        come back here anytime to edit.
      </>
    ),
    matches: (p) => p.startsWith("/profile"),
    findTarget: () =>
      findInSidebar((btn) => btn.getAttribute("aria-label") === "Open profile"),
  });

  return steps;
}

function readPhase(): Phase {
  try {
    if (window.localStorage.getItem(DONE_KEY)) return "done";
    if (window.localStorage.getItem(STEP_KEY) !== null) return "card";
  } catch {
    return "done";
  }
  return "modal";
}

function readStep(maxStep: number): number {
  try {
    const raw = window.localStorage.getItem(STEP_KEY);
    if (raw === null) return 0;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) ? Math.max(0, Math.min(maxStep, n)) : 0;
  } catch {
    return 0;
  }
}

/**
 * Tracks a target element's bounding rect, polling on resize/scroll plus a
 * cheap interval so transitions (sidebar collapse, mobile drawer, iframe
 * scroll) stay glued. Uses getRectInParent so in-iframe targets resolve to
 * the parent document's viewport coordinates.
 */
function useTargetRect(target: HTMLElement | null): DOMRect | null {
  const [rect, setRect] = useState<DOMRect | null>(() =>
    target ? getRectInParent(target) : null,
  );
  useEffect(() => {
    if (!target) {
      setRect(null);
      return;
    }
    let alive = true;
    function measure() {
      if (!alive || !target) return;
      setRect(getRectInParent(target));
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

export function LaunchWelcome({
  firstName,
  hasCalendarLink = true,
  // Server says this member just onboarded and hasn't done the tour yet — show
  // it once, overriding any browser-localStorage "seen" flag (the tour is now
  // tracked per USER on the server).
  shouldShowTour = false,
  // Tabless mode: pages render in this window, so there's no `dali:tabNavigated`
  // from an iframe to advance steps — we watch the router location instead.
  tabless = false,
}: {
  firstName: string;
  hasCalendarLink?: boolean;
  shouldShowTour?: boolean;
  tabless?: boolean;
}) {
  const routerLocation = useLocation();
  // Steps are stable for a given user within a session; the calendar step is
  // included only when they haven't linked a calendar yet.
  const steps = useRef(buildSteps({ hasCalendarLink })).current;
  const [phase, setPhase] = useState<Phase>("done");
  const [step, setStep] = useState(0);
  const [arrived, setArrived] = useState(false);
  const [sidebarTarget, setSidebarTarget] = useState<HTMLElement | null>(null);
  const nextButtonRef = useRef<HTMLButtonElement | null>(null);
  const [nextTarget, setNextTarget] = useState<HTMLElement | null>(null);
  const titleId = useId();

  useEffect(() => {
    // Auto-show is purely server-driven: only a freshly-onboarded member
    // (onboardedAt set, tourCompletedAt null) sees the tour automatically.
    // localStorage no longer triggers it — clearing browser state or opening
    // incognito won't re-pop the welcome modal for an established member.
    // localStorage IS still consulted to *resume* a tour mid-flight on reload,
    // so a freshly-onboarded user who started the tour and then reloaded
    // continues where they were instead of jumping back to step 0.
    if (!shouldShowTour) {
      setPhase("done");
      return;
    }
    const resumed = readPhase();
    if (resumed === "card") {
      setPhase("card");
      setStep(readStep(steps.length));
    } else {
      setPhase("modal");
      setStep(0);
    }
  }, [steps.length, shouldShowTour]);

  // Manual re-run: a "Start tour" button (next to the DALI OS logo) dispatches
  // this event. Re-runs the tour regardless of past completion.
  useEffect(() => {
    function onStart() {
      try {
        window.localStorage.removeItem(DONE_KEY);
      } catch {
        // ignore
      }
      setStep(0);
      setArrived(false);
      setPhase("modal");
    }
    window.addEventListener("dali:start-tour", onStart);
    return () => window.removeEventListener("dali:start-tour", onStart);
  }, []);

  // Re-resolve the highlight target whenever the active step changes.
  // Cheap interval because the target may not be present at mount time
  // (sidebar not laid out yet, calendar iframe still loading, etc.).
  // Info-only steps (no findTarget) never show a spotlight.
  //
  // For steps that have no URL `matches` (e.g. the in-page Schedule Meeting
  // pill), there's no dali:tabNavigated to advance on, so we attach a DOM
  // click listener to the resolved target instead. Clicking the spotlit
  // element flips the step to "arrived" the same way a URL change would.
  useEffect(() => {
    if (phase !== "card") return;
    if (step >= steps.length) return;
    const s = steps[step];
    const find = s.findTarget;
    if (!find || arrived) {
      setSidebarTarget(null);
      return;
    }
    const advanceOnClick = !s.matches;
    let attached: HTMLElement | null = null;
    function onClick() {
      setArrived(true);
    }
    function resolve() {
      const found = find!();
      setSidebarTarget(found);
      if (advanceOnClick && found !== attached) {
        if (attached) attached.removeEventListener("click", onClick);
        if (found) found.addEventListener("click", onClick);
        attached = found;
      }
    }
    resolve();
    const id = window.setInterval(resolve, 300);
    return () => {
      window.clearInterval(id);
      if (attached) attached.removeEventListener("click", onClick);
    };
  }, [phase, step, arrived]);

  // Pulse the card's primary action button. For click-driven steps this is
  // the Next button after the user arrives at the matched page. For info-only
  // steps (e.g. MCP) the primary action is shown immediately, so pulse it
  // from the start. Refs alone don't trigger re-renders, so we copy the
  // current DOM node into state once it's in the tree.
  useEffect(() => {
    if (phase !== "card") {
      setNextTarget(null);
      return;
    }
    if (step >= steps.length) {
      setNextTarget(null);
      return;
    }
    const s = steps[step];
    const shouldPulse = s.findTarget ? arrived : true;
    setNextTarget(shouldPulse ? nextButtonRef.current : null);
  }, [phase, step, arrived]);

  // Listen for iframe-reported tab navigation — that's how the workspace
  // signals "the user is now looking at X". Sidebar clicks open iframe tabs,
  // so useLocation on the parent shell never fires.
  const handleUrl = useCallback(
    (url: string) => {
      if (phase !== "card") return;
      if (arrived) return;
      if (step >= steps.length) return;
      const match = steps[step].matches;
      if (!match) return; // info-only step — URL changes don't advance it
      try {
        const path = new URL(url, window.location.origin).pathname;
        if (match(path)) setArrived(true);
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

  // Tabless equivalent of the `dali:tabNavigated` bridge above: the page is a
  // real navigation in this window, so advance the tour off the router location.
  useEffect(() => {
    if (!tabless) return;
    handleUrl(routerLocation.pathname);
  }, [tabless, routerLocation.pathname, handleUrl]);

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

  function finishAndGoHome() {
    window.postMessage(
      { type: "dali:openTab", url: "/", label: "Home" },
      window.location.origin,
    );
    finishTour();
  }

  function finishTour() {
    try {
      window.localStorage.setItem(DONE_KEY, new Date().toISOString());
      window.localStorage.removeItem(STEP_KEY);
    } catch {
      // ignore
    }
    // Persist completion per-user so the tour isn't auto-shown again (the
    // localStorage flag above is just a same-browser fast path). Best-effort.
    void fetch("/api/tour/complete", { method: "POST", credentials: "include" }).catch(
      () => {},
    );
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
          <div className="flex items-center justify-end">
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
              Welcome to DALI OS
            </h2>
            <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
              Hi {firstName}. DALI OS is the home of everything DALI.
              Want a quick tour?
            </p>
          </div>
          <div className="flex items-center justify-end gap-2 pt-2">
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

  const isFinal = step >= steps.length;
  const current = isFinal ? null : steps[step];

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
                  : current!.eyebrow}
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

          <div className="text-sm text-foreground leading-relaxed">
            {isFinal ? (
              <>Welcome to DALI OS!</>
            ) : arrived ? (
              current!.arrived
            ) : (
              current!.cta
            )}
          </div>

          <div className="flex items-center gap-1.5" aria-hidden="true">
            {steps.map((_, i) => (
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
                onClick={finishAndGoHome}
                className="inline-flex items-center gap-1.5 rounded-lg bg-accent-coral px-3 py-1.5 text-sm font-semibold text-white hover:bg-accent-coral/90"
              >
                Back to home
              </button>
            ) : arrived ? (
              <>
                {current?.arrivedAction && (
                  <button
                    type="button"
                    onClick={current.arrivedAction.onClick}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-accent-coral px-3 py-1.5 text-sm font-semibold text-accent-coral hover:bg-accent-coral/10"
                  >
                    {current.arrivedAction.label}
                  </button>
                )}
                <button
                  ref={nextButtonRef}
                  type="button"
                  onClick={advance}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-accent-coral px-3 py-1.5 text-sm font-semibold text-white hover:bg-accent-coral/90"
                >
                  Next
                  <ArrowRight className="w-4 h-4" />
                </button>
              </>
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
