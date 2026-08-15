import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router";
import {
  PartyPopper,
  ArrowRight,
  X as XIcon,
  Check,
  Lock,
} from "lucide-react";
import { Modal } from "./Modal";
import { GUIDE_STEP_VIEWS } from "./guide/steps";
import {
  guideProgress,
  isStepCleared,
  type GuideRequirements,
} from "~/lib/guide";

const steps = GUIDE_STEP_VIEWS;

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

const PAD = 6;

/** The padded box the spotlight cuts out and the ring draws around. */
function boxFor(rect: DOMRect) {
  return {
    top: rect.top - PAD,
    left: rect.left - PAD,
    width: rect.width + PAD * 2,
    height: rect.height + PAD * 2,
  };
}

/**
 * Pulsing coral ring positioned around an element. No dim.
 *
 * `nudge` restarts the animation when it changes — bumped when the member
 * clicks somewhere the guide is blocking, so the dead click answers itself by
 * drawing the eye to the one thing that is clickable.
 */
function PulseRing({
  target,
  zIndex,
  nudge = 0,
}: {
  target: HTMLElement;
  zIndex: number;
  nudge?: number;
}) {
  const rect = useTargetRect(target);
  if (!rect) return null;
  return (
    <div
      key={nudge}
      aria-hidden="true"
      className={
        "pointer-events-none fixed rounded-md " +
        (nudge > 0 ? "launch-tour-nudge" : "launch-tour-pulse")
      }
      style={{ ...boxFor(rect), zIndex }}
    />
  );
}

/**
 * Full spotlight: dims the page everywhere except a cut-out over `target`,
 * with a pulsing ring on top, and blocks interaction with everything outside
 * the cut-out. While a step is pointing at something, the only live surfaces
 * are that element and the guide card (z-50, above these) — so the member
 * either does the step or leaves the guide, and can't half-navigate somewhere
 * the guide isn't tracking.
 *
 * The dim and the blocking are separate layers on purpose: one box-shadow
 * gives a seamless dim, while hit-testing needs four rects around the hole.
 * Sub-pixel seams between invisible blockers cost nothing; seams in the dim
 * would show as light lines.
 */
function Spotlight({
  target,
  onBlockedClick,
  nudge,
}: {
  target: HTMLElement;
  onBlockedClick: () => void;
  nudge: number;
}) {
  const rect = useTargetRect(target);
  if (!rect) return null;
  const box = boxFor(rect);
  const bottom = box.top + box.height;
  const right = box.left + box.width;
  const blocker = "fixed z-40 cursor-not-allowed";
  return (
    <>
      <div
        aria-hidden="true"
        className="pointer-events-none fixed z-40 rounded-md"
        style={{ ...box, boxShadow: "0 0 0 9999px rgba(0, 0, 0, 0.55)" }}
      />
      <div
        className={blocker}
        onClick={onBlockedClick}
        style={{ top: 0, left: 0, right: 0, height: Math.max(0, box.top) }}
      />
      <div
        className={blocker}
        onClick={onBlockedClick}
        style={{ top: Math.max(0, bottom), left: 0, right: 0, bottom: 0 }}
      />
      <div
        className={blocker}
        onClick={onBlockedClick}
        style={{
          top: Math.max(0, box.top),
          left: 0,
          width: Math.max(0, box.left),
          height: Math.max(0, box.height),
        }}
      />
      <div
        className={blocker}
        onClick={onBlockedClick}
        style={{
          top: Math.max(0, box.top),
          left: Math.max(0, right),
          right: 0,
          height: Math.max(0, box.height),
        }}
      />
      <PulseRing target={target} zIndex={41} nudge={nudge} />
    </>
  );
}

type Phase = "modal" | "card" | "done";

export type GuideCardProps = {
  firstName: string;
  /** Step ids the member has already cleared (server state). */
  clearedIds: string[];
  /** Which gated steps the member's account already satisfies. */
  requirements: GuideRequirements;
  /** Member has been through the guide before — they're being brought back for
   *  outstanding setup, not walked through the app for the first time. */
  returning?: boolean;
  /** Server says: auto-show the guide (onboarded, hasn't dismissed it). */
  shouldShowTour?: boolean;
  /** Tabless mode: pages render in this window, so there's no
   *  `dali:tabNavigated` from an iframe — watch the router location instead. */
  tabless?: boolean;
};

export function LaunchWelcome({
  firstName,
  clearedIds: initialCleared,
  requirements: initialRequirements,
  returning = false,
  shouldShowTour = false,
  tabless = false,
}: GuideCardProps) {
  const routerLocation = useLocation();
  const [phase, setPhase] = useState<Phase>("done");
  const [step, setStep] = useState(0);
  const [arrived, setArrived] = useState(false);
  const [cleared, setCleared] = useState<string[]>(initialCleared);
  const [requirements, setRequirements] =
    useState<GuideRequirements>(initialRequirements);
  const [sidebarTarget, setSidebarTarget] = useState<HTMLElement | null>(null);
  // Bumped on every click the spotlight blocks, to re-flash the ring.
  const [nudge, setNudge] = useState(0);
  const nextButtonRef = useRef<HTMLButtonElement | null>(null);
  const [nextTarget, setNextTarget] = useState<HTMLElement | null>(null);
  const titleId = useId();

  const progress = useMemo(
    () => guideProgress(cleared, requirements),
    [cleared, requirements],
  );

  const isFinal = step >= steps.length;
  const current = isFinal ? null : steps[step];
  const gate = current?.requires;
  // A gated step is satisfied by account state, not by clicking Next — that's
  // the whole point of gating it.
  const gateMet = gate ? requirements[gate] : false;
  const stepDone = isFinal || (gate ? gateMet : current!.matches ? arrived : true);

  const post = useCallback((body: Record<string, string>) => {
    const form = new FormData();
    for (const [k, v] of Object.entries(body)) form.append(k, v);
    return fetch("/api/tour/progress", {
      method: "POST",
      body: form,
      credentials: "include",
    });
  }, []);

  const refreshState = useCallback(async () => {
    try {
      const res = await fetch("/api/tour/progress", { credentials: "include" });
      if (!res.ok) return;
      const data = await res.json();
      if (data?.requirements) setRequirements(data.requirements);
      if (Array.isArray(data?.clearedIds)) setCleared(data.clearedIds);
    } catch {
      // Offline or a transient failure — the next poll picks it up.
    }
  }, []);

  // Dismissing silences the guide for the page the member is on, not for good:
  // while a required step is outstanding the server keeps shouldShowTour true,
  // and the next navigation brings the guide back at the step they still owe.
  // Re-reads from the server rather than trusting this card's copy, which stops
  // being refreshed the moment they dismiss.
  const snoozed = useRef(false);
  const reopenIfOwed = useCallback(async () => {
    if (!snoozed.current) return;
    snoozed.current = false;
    try {
      const res = await fetch("/api/tour/progress", { credentials: "include" });
      if (!res.ok) return;
      const data = await res.json();
      const owed = data?.progress?.outstanding?.[0];
      if (!owed) return;
      // Reopen on the step they actually owe, not wherever they left off. It
      // comes back because setup is incomplete, so it should say so — making
      // them re-walk the tour to reach the calendar step would punish the
      // dismissal rather than collect the thing that's missing. Gated steps
      // also carry no spotlight, so the page they just navigated to stays
      // usable while the card asks.
      const at = steps.findIndex((s) => s.id === owed.id);
      if (at < 0) return;
      setRequirements(data.requirements);
      setCleared(data.clearedIds);
      setStep(at);
      setArrived(false);
      setNudge(0);
      setPhase("card");
    } catch {
      // Offline — the next navigation tries again.
    }
  }, []);

  // Auto-show is server-driven, and resumes at the first unfinished step so a
  // member who bailed halfway doesn't have to walk the whole thing again.
  //
  // Fires at most once. The loader hands back a fresh array/object every
  // render, so an effect that re-ran on their identity would keep re-deciding
  // the phase — and stomp on a guide the member had just opened by hand.
  const autoShown = useRef(false);
  useEffect(() => {
    if (!shouldShowTour || autoShown.current) return;
    autoShown.current = true;
    const resume = guideProgress(initialCleared, initialRequirements);
    // A returning member is here because setup is incomplete, so open on the
    // step they owe. Established members were backfilled with no cleared steps,
    // so resuming by position would drop them at step one — restarting a tour
    // they never asked for and, since step one spotlights the sidebar, locking
    // the page they were actually using.
    const owed = returning ? resume.outstanding[0] : undefined;
    const at = owed ? steps.findIndex((s) => s.id === owed.id) : -1;
    const next = at >= 0 ? at : Math.min(resume.resumeIndex, steps.length);
    setStep(next);
    setArrived(false);
    setPhase(next > 0 ? "card" : "modal");
  }, [shouldShowTour, initialCleared, initialRequirements, returning]);

  // Manual (re)start from the Help page. `detail.restart` means start over from
  // step one; otherwise pick up where they left off.
  useEffect(() => {
    function onStart(e: Event) {
      const restart = Boolean((e as CustomEvent).detail?.restart);
      const next = restart
        ? 0
        : Math.min(guideProgress(cleared, requirements).resumeIndex, steps.length);
      setStep(next);
      setArrived(false);
      setPhase(restart || next === 0 ? "modal" : "card");
      // "Start over" resets progress server-side, so re-read rather than
      // trusting the copy this card is holding.
      if (restart) void refreshState();
    }
    window.addEventListener("dali:start-tour", onStart);
    return () => window.removeEventListener("dali:start-tour", onStart);
  }, [cleared, requirements, refreshState]);

  // While the member is sitting on a gate they haven't met, watch for them
  // meeting it. Uploading a photo or linking a calendar happens on another
  // page (or another tab), so nothing in this window would otherwise tell us.
  useEffect(() => {
    if (phase !== "card" || !gate || gateMet) return;
    const id = window.setInterval(refreshState, 4000);
    window.addEventListener("focus", refreshState);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("focus", refreshState);
    };
  }, [phase, gate, gateMet, refreshState]);

  // Re-resolve the highlight target whenever the active step changes. Cheap
  // interval because the target may not be present at mount time (sidebar not
  // laid out yet, calendar iframe still loading, etc.). Steps with no
  // findTarget never show a spotlight.
  useEffect(() => {
    if (phase !== "card" || isFinal) return;
    const find = steps[step].findTarget;
    if (!find || stepDone) {
      setSidebarTarget(null);
      return;
    }
    function resolve() {
      setSidebarTarget(find!());
    }
    resolve();
    const id = window.setInterval(resolve, 300);
    return () => window.clearInterval(id);
  }, [phase, step, stepDone, isFinal]);

  // Pulse the card's primary action once it's the thing to click: after arrival
  // on a click-driven step, immediately on info steps, and never on an unmet
  // gate (there the action button is the thing to click, not Next). Refs alone
  // don't trigger re-renders, so copy the DOM node into state.
  useEffect(() => {
    if (phase !== "card" || isFinal) {
      setNextTarget(null);
      return;
    }
    setNextTarget(stepDone ? nextButtonRef.current : null);
  }, [phase, step, stepDone, isFinal]);

  // Listen for iframe-reported tab navigation — that's how the workspace
  // signals "the user is now looking at X". Sidebar clicks open iframe tabs,
  // so useLocation on the parent shell never fires.
  const handleUrl = useCallback(
    (url: string) => {
      if (phase !== "card" || arrived || isFinal) return;
      const match = steps[step].matches;
      if (!match) return; // info or gated step — URL changes don't clear it
      try {
        if (match(new URL(url, window.location.origin).pathname)) setArrived(true);
      } catch {
        // Bad URL — ignore.
      }
    },
    [phase, step, arrived, isFinal],
  );

  useEffect(() => {
    function onMsg(e: MessageEvent) {
      if (e.origin !== window.location.origin) return;
      const d = e.data;
      if (!d) return;
      // The Help page lives in a workspace iframe, so its "open the guide"
      // click arrives as a message rather than an event on this window.
      if (d.type === "dali:start-tour") {
        window.dispatchEvent(
          new CustomEvent("dali:start-tour", {
            detail: { restart: Boolean(d.restart) },
          }),
        );
        return;
      }
      if (d.type !== "dali:tabNavigated" || typeof d.url !== "string") return;
      void reopenIfOwed();
      handleUrl(d.url);
    }
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [handleUrl, reopenIfOwed]);

  // Tabless equivalent of the `dali:tabNavigated` bridge above: the page is a
  // real navigation in this window, so clear the step off the router location.
  useEffect(() => {
    if (!tabless) return;
    handleUrl(routerLocation.pathname);
  }, [tabless, routerLocation.pathname, handleUrl]);

  useEffect(() => {
    if (!tabless) return;
    void reopenIfOwed();
  }, [tabless, routerLocation.key, reopenIfOwed]);

  function startGuide() {
    void post({ intent: "start" });
    setArrived(false);
    setPhase("card");
  }

  /**
   * Leave the guide. Progress is kept — the Help page can resume it, and while
   * a required step is outstanding the next navigation reopens it.
   */
  function dismiss() {
    void post({ intent: "dismiss" });
    snoozed.current = true;
    setPhase("done");
  }

  function finishAndGoHome() {
    window.postMessage(
      { type: "dali:openTab", url: "/", label: "Home" },
      window.location.origin,
    );
    dismiss();
  }

  function advance() {
    const id = steps[step].id;
    setCleared((prev) => (prev.includes(id) ? prev : [...prev, id]));
    void post({ intent: "step", stepId: id });
    setStep(step + 1);
    setArrived(false);
    setNudge(0);
  }

  if (phase === "done") return null;

  if (phase === "modal") {
    const returning = progress.cleared > 0;
    return (
      <Modal open onClose={dismiss} labelledBy={titleId}>
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-end">
            <button
              type="button"
              onClick={dismiss}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Not now
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
              Hi {firstName}. DALI OS is the home of everything DALI — projects,
              education, people, and more. The guide walks you through the{" "}
              {steps.length} things worth knowing on day one, and sets up the
              parts of your account the rest of the lab depends on. It takes
              about five minutes, and you can stop and pick it up later.
            </p>
          </div>
          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={startGuide}
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent-coral px-4 py-2 text-sm font-semibold text-white hover:bg-accent-coral/90"
            >
              {returning ? "Pick up where I left off" : "Show me around"}
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </Modal>
    );
  }

  const showAction = current?.action && !(gate && gateMet);

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
        @keyframes launch-tour-nudge {
          0%, 100% { transform: scale(1); }
          40% { transform: scale(1.07); }
        }
        .launch-tour-pulse {
          animation: launch-tour-pulse 1.6s ease-in-out infinite;
        }
        .launch-tour-nudge {
          animation:
            launch-tour-pulse 1.6s ease-in-out infinite,
            launch-tour-nudge 0.45s ease-out 1;
        }
        @media (prefers-reduced-motion: reduce) {
          .launch-tour-pulse, .launch-tour-nudge { animation: none; }
        }
      `}</style>

      {/* Sidebar spotlight before they click. Also the interaction lock: while
          it's up, only the spotlit element and this card respond. Steps with no
          spotlight (the gated ones) deliberately leave the page live — the
          member has to reach a settings page to satisfy the gate. */}
      {sidebarTarget && !stepDone && (
        <Spotlight
          target={sidebarTarget}
          nudge={nudge}
          onBlockedClick={() => setNudge((n) => n + 1)}
        />
      )}

      {/* Next-button ring once it's the thing to click (no dim — the card is
          already prominent). */}
      {nextTarget && stepDone && !isFinal && (
        <PulseRing target={nextTarget} zIndex={60} />
      )}

      <div className="fixed bottom-4 right-4 z-50 w-80 max-w-[calc(100vw-2rem)] pointer-events-auto">
        <div className="bg-card border border-border rounded-2xl shadow-brand-2 p-4 flex flex-col gap-3">
          <div className="flex items-start justify-between gap-2">
            <span className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-accent-coral">
              {isFinal ? (
                <PartyPopper className="w-4 h-4" />
              ) : stepDone ? (
                <Check className="w-4 h-4" />
              ) : gate ? (
                <Lock className="w-4 h-4" />
              ) : (
                current!.icon
              )}
              {isFinal ? "All set" : current!.title}
            </span>
            <button
              type="button"
              onClick={dismiss}
              className="text-muted-foreground hover:text-foreground -mt-1 -mr-1 p-1"
              aria-label="Leave the guide"
            >
              <XIcon className="w-4 h-4" />
            </button>
          </div>

          <div className="text-sm text-foreground leading-relaxed">
            {isFinal ? (
              <>
                That&apos;s everything. <strong>Home</strong> ties it together —
                your week, open tasks, and lab events. Everything here is written
                up under <strong>Help</strong> if you want it again.
              </>
            ) : stepDone && current!.arrived ? (
              current!.arrived
            ) : (
              current!.cta
            )}
          </div>

          <div>
            <div className="flex items-center gap-1" aria-hidden="true">
              {steps.map((s, i) => (
                <span
                  key={s.id}
                  className={
                    "h-1 rounded-full flex-1 " +
                    (isFinal || isStepCleared(s, cleared, requirements) ||
                    (i === step && stepDone)
                      ? "bg-accent-coral"
                      : "bg-muted-foreground/20")
                  }
                />
              ))}
            </div>
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              {isFinal
                ? `${progress.total} of ${progress.total} done`
                : `Step ${step + 1} of ${steps.length}`}
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
            {isFinal ? (
              <button
                type="button"
                onClick={finishAndGoHome}
                className="inline-flex items-center gap-1.5 rounded-lg bg-accent-coral px-3 py-1.5 text-sm font-semibold text-white hover:bg-accent-coral/90"
              >
                Back to home
              </button>
            ) : (
              <>
                {!stepDone && (
                  <button
                    type="button"
                    onClick={dismiss}
                    className="text-xs text-muted-foreground hover:text-foreground mr-auto"
                  >
                    Finish later
                  </button>
                )}
                {showAction && (
                  <button
                    type="button"
                    onClick={current!.action!.onClick}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-accent-coral px-3 py-1.5 text-sm font-semibold text-accent-coral hover:bg-accent-coral/10"
                  >
                    {current!.action!.label}
                  </button>
                )}
                {/* Click-driven steps keep an escape hatch for a member who is
                    already on the page. Gated steps don't get one — the account
                    state is the only way past. */}
                {!stepDone && !gate && current!.matches && (
                  <button
                    type="button"
                    onClick={() => setArrived(true)}
                    className="text-xs text-muted-foreground hover:text-foreground"
                    title="Skip this step"
                  >
                    I&apos;m there
                  </button>
                )}
                <button
                  ref={nextButtonRef}
                  type="button"
                  onClick={advance}
                  disabled={!stepDone}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-accent-coral px-3 py-1.5 text-sm font-semibold text-white hover:bg-accent-coral/90 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-accent-coral"
                >
                  Next
                  <ArrowRight className="w-4 h-4" />
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
