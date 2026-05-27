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
  Bot,
  Copy,
} from "lucide-react";
import { Modal } from "./Modal";

const DONE_KEY = "dalios-launch-welcome-seen-v1";
const STEP_KEY = "dalios-launch-tour-step-v1";

const CLAUDE_MCP_COMMAND =
  "claude mcp add --transport http dalios https://os.dali.dartmouth.edu/mcp";

function CopyableCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    try {
      navigator.clipboard.writeText(command);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // navigator.clipboard unavailable (insecure context, etc) — give up silently
    }
  }
  return (
    <div className="flex items-center gap-2 rounded-md bg-zinc-900 px-2.5 py-2 text-xs font-mono text-zinc-100">
      <code className="flex-1 truncate" title={command}>
        {command}
      </code>
      <button
        type="button"
        onClick={copy}
        className="text-zinc-400 hover:text-white flex-shrink-0"
        aria-label="Copy command"
      >
        {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
      </button>
    </div>
  );
}

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
  /** Optional primary action for info-only steps. Click runs onClick AND
   *  advances the tour. */
  action?: { label: string; onClick: () => void };
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
    eyebrow: "Projects",
    cta: (
      <>
        Open <strong>Projects</strong> from the sidebar.
      </>
    ),
    arrived: <>All active projects live here.</>,
    matches: (p) => p.startsWith("/projects"),
    findTarget: () => findByExactText("Projects"),
  },
  {
    icon: <CalendarDays className="w-4 h-4" />,
    eyebrow: "Calendar",
    cta: (
      <>
        Open <strong>Calendar</strong> from the sidebar.
      </>
    ),
    arrived: <>Lab meetings and events.</>,
    matches: (p) => p.startsWith("/calendar"),
    findTarget: () => findByExactText("Calendar"),
  },
  {
    icon: <UserCircle2 className="w-4 h-4" />,
    eyebrow: "Profile",
    cta: (
      <>
        Open your <strong>profile</strong> from the bottom of the sidebar.
      </>
    ),
    arrived: <>Add a photo and your details here.</>,
    matches: (p) => p.startsWith("/profile"),
    findTarget: () =>
      findInSidebar((btn) => btn.getAttribute("aria-label") === "Open profile"),
  },
  {
    icon: <Bot className="w-4 h-4" />,
    eyebrow: "Connect any AI",
    cta: (
      <>
        <p>
          Connect any AI assistant to the <strong>DALI OS MCP</strong> and let
          it read your DALI data for you. In Claude Code:
        </p>
        <div className="mt-2">
          <CopyableCommand command={CLAUDE_MCP_COMMAND} />
        </div>
      </>
    ),
    action: {
      label: "Open docs",
      onClick: () => {
        // Layout listens for dali:openTab on the parent window and opens it
        // in the workspace iframe rather than navigating the top frame.
        window.postMessage(
          {
            type: "dali:openTab",
            url: "/help/mcp",
            label: "Connect AI to DALI OS",
          },
          window.location.origin,
        );
      },
    },
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
  // Info-only steps (no findTarget) never show a spotlight.
  useEffect(() => {
    if (phase !== "card") return;
    if (step >= STEPS.length) return;
    const find = STEPS[step].findTarget;
    if (!find || arrived) {
      setSidebarTarget(null);
      return;
    }
    function resolve() {
      setSidebarTarget(find!());
    }
    resolve();
    const id = window.setInterval(resolve, 300);
    return () => window.clearInterval(id);
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
    if (step >= STEPS.length) {
      setNextTarget(null);
      return;
    }
    const s = STEPS[step];
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
      if (step >= STEPS.length) return;
      const match = STEPS[step].matches;
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
              Welcome to DALI OS
            </h2>
            <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
              Hi {firstName}. DALI OS is the home of everything DALI,
              replacing Notion as the lab&apos;s internal site. Want a quick
              tour?
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
              <>
                That&apos;s the tour. Thanks for coming. Enjoy the launch
                party.
              </>
            ) : arrived ? (
              current!.arrived
            ) : (
              current!.cta
            )}
          </div>

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
                Done
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
            ) : current && !current.findTarget ? (
              <>
                <button
                  type="button"
                  onClick={advance}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  Skip
                </button>
                <button
                  ref={nextButtonRef}
                  type="button"
                  onClick={() => {
                    current.action?.onClick();
                    advance();
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-accent-coral px-3 py-1.5 text-sm font-semibold text-white hover:bg-accent-coral/90"
                >
                  {current.action?.label ?? "Next"}
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
