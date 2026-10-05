import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { X } from "lucide-react";
import { Modal } from "~/components/Modal";

const ENTER_MS = 320;
const EXIT_MS = 260;

export type SlideOverAccent = "coral" | "teal" | "yellow";

const ACCENTS: Record<SlideOverAccent, string> = {
  coral: "#FF8B81",
  teal: "#00ADAB",
  yellow: "#FFD461",
};

/**
 * Reusable dark-navy slide-over panel. Enters from the right with a crisp
 * animation and shares the textured surface used by the ProjectStats panels,
 * so the whole focused-editing surface reads as one visual family.
 *
 * Lifecycle: the outer `open` prop controls intent, but internal `rendered`
 * state lingers for the exit duration so children (whose data the parent may
 * clear on close) stay painted while the panel slides out. The last non-null
 * children snapshot is cached so the exit transition always has content.
 */
export function SlideOver({
  open,
  onClose,
  overline,
  accent = "teal",
  title,
  subtitle,
  footer,
  width = 460,
  children,
}: {
  open: boolean;
  onClose: () => void;
  overline?: string;
  accent?: SlideOverAccent;
  title: string;
  subtitle?: string;
  footer?: ReactNode;
  width?: number;
  children?: ReactNode;
}) {
  const titleId = useId();
  const [rendered, setRendered] = useState(open);
  const [entered, setEntered] = useState(false);
  // Cache the content-shaped props so the exit animation always has a coherent
  // sheet to paint — parents typically null their data on close, which would
  // otherwise flash an empty header mid-slide-out.
  const snapshot = useRef({ title, subtitle, overline, footer, children });
  if (open) {
    snapshot.current = { title, subtitle, overline, footer, children };
  }
  const view = open ? { title, subtitle, overline, footer, children } : snapshot.current;

  useEffect(() => {
    if (open) {
      setRendered(true);
      // Two rAFs: first commits the initial off-screen frame, second swaps to
      // the on-screen target so the transition actually runs. One rAF is
      // sometimes dropped if layout is reused across renders.
      let r2 = 0;
      const r1 = requestAnimationFrame(() => {
        r2 = requestAnimationFrame(() => setEntered(true));
      });
      return () => {
        cancelAnimationFrame(r1);
        cancelAnimationFrame(r2);
      };
    } else {
      setEntered(false);
      const t = setTimeout(() => setRendered(false), EXIT_MS);
      return () => clearTimeout(t);
    }
  }, [open]);

  if (!rendered) return null;

  const accentColor = ACCENTS[accent];

  return (
    <>
      <SlideOverStyles />
      <Modal
        open
        onClose={onClose}
        labelledBy={titleId}
        className={
          "fixed inset-0 z-50 flex items-stretch justify-end pr-sheet-overlay" +
          (entered ? " is-open" : "")
        }
        containerClassName={
          "pr-sheet-panel pr-panel" + (entered ? " is-open" : "")
        }
      >
        <div
          className="pr-panel-body flex flex-col h-full"
          style={{ width: `min(${width}px, 100vw)` }}
        >
          <header className="px-6 pt-6 pb-4 flex items-start gap-3">
            <div className="flex-1 min-w-0">
              {view.overline && (
                <div className="pr-overline" style={{ color: accentColor }}>
                  <span
                    className="diamond"
                    style={{ background: accentColor }}
                    aria-hidden
                  />
                  <span>{view.overline}</span>
                </div>
              )}
              <h2 id={titleId} className="pr-title mt-2">
                {view.title}
              </h2>
              {view.subtitle && <p className="pr-sub mt-1.5">{view.subtitle}</p>}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="pr-sheet-close shrink-0"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </header>

          <div className="flex-1 overflow-y-auto px-6 pb-6 pr-sheet-body">
            {view.children}
          </div>

          {view.footer && (
            <div className="pr-sheet-footer px-6 py-4">{view.footer}</div>
          )}
        </div>
      </Modal>
    </>
  );
}

/**
 * Styles for the sheet. The .pr-panel / .pr-overline / .pr-title / .pr-sub
 * class names mirror ProjectStats.tsx on purpose — redeclaring them here lets
 * the sheet work on any route that doesn't mount PrStatsStyles. They're
 * identical so the cascade stays stable regardless of mount order.
 */
function SlideOverStyles() {
  return (
    <style>{`
      /* ----- animation ----- */
      .pr-sheet-overlay {
        background: rgba(5, 10, 18, 0);
        backdrop-filter: blur(0px);
        -webkit-backdrop-filter: blur(0px);
        transition: background ${ENTER_MS}ms cubic-bezier(0.22, 1, 0.36, 1),
                    backdrop-filter ${ENTER_MS}ms cubic-bezier(0.22, 1, 0.36, 1);
      }
      .pr-sheet-overlay.is-open {
        background: rgba(5, 10, 18, 0.55);
        backdrop-filter: blur(2px);
        -webkit-backdrop-filter: blur(2px);
      }

      .pr-sheet-panel {
        position: relative;
        height: 100%;
        max-width: 100vw;
        transform: translate3d(100%, 0, 0);
        transition: transform ${ENTER_MS}ms cubic-bezier(0.22, 1, 0.36, 1);
        box-shadow:
          -24px 0 48px -8px rgba(0, 0, 0, 0.55),
          -1px 0 0 0 rgba(255, 255, 255, 0.06);
        border-radius: 0;
      }
      .pr-sheet-panel.is-open { transform: translate3d(0, 0, 0); }

      /* ----- shared dark-panel surface (mirrors ProjectStats) ----- */
      .pr-sheet-panel.pr-panel {
        background-color: #0B1726;
        background-image:
          radial-gradient(ellipse at 15% 0%, rgba(255, 139, 129, 0.10), transparent 55%),
          radial-gradient(ellipse at 100% 100%, rgba(0, 173, 171, 0.08), transparent 55%),
          linear-gradient(to right, rgba(255, 255, 255, 0.028) 1px, transparent 1px),
          linear-gradient(to bottom, rgba(255, 255, 255, 0.028) 1px, transparent 1px);
        background-size: auto, auto, 22px 100%, 100% 22px;
        overflow: hidden;
      }
      .pr-sheet-panel.pr-panel::before {
        content: "";
        position: absolute; inset: 0;
        background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='140' height='140'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.055 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>");
        opacity: 0.6;
        mix-blend-mode: overlay;
        pointer-events: none;
      }
      .pr-sheet-panel.pr-panel::after {
        content: "";
        position: absolute; inset: 0;
        background: radial-gradient(ellipse 80% 50% at 50% -20%, rgba(255, 255, 255, 0.07), transparent 60%);
        pointer-events: none;
      }
      .pr-sheet-panel .pr-panel-body { position: relative; z-index: 1; }

      /* ----- shared text + overline (mirrors ProjectStats) ----- */
      .pr-sheet-panel .pr-overline {
        display: inline-flex; align-items: center; gap: 6px;
        font-size: 10px; font-weight: 700;
        letter-spacing: 0.14em; text-transform: uppercase;
      }
      .pr-sheet-panel .pr-overline .diamond {
        width: 8px; height: 8px; transform: rotate(45deg); border-radius: 1px;
      }
      .pr-sheet-panel .pr-title {
        color: #F5F7FA; font-weight: 700; font-size: 22px;
        line-height: 1.15; letter-spacing: -0.01em;
      }
      .pr-sheet-panel .pr-sub {
        color: rgba(245, 247, 250, 0.55); font-size: 12px; line-height: 1.4;
      }

      /* ----- close button + footer ----- */
      .pr-sheet-close {
        display: grid; place-items: center;
        height: 32px; width: 32px;
        border-radius: 999px;
        color: rgba(245, 247, 250, 0.65);
        background: rgba(255, 255, 255, 0.04);
        border: 1px solid rgba(255, 255, 255, 0.08);
        transition: background 160ms ease, color 160ms ease, border-color 160ms ease;
      }
      .pr-sheet-close:hover {
        background: rgba(255, 255, 255, 0.09);
        color: #F5F7FA;
        border-color: rgba(255, 255, 255, 0.18);
      }

      .pr-sheet-footer {
        border-top: 1px solid rgba(255, 255, 255, 0.07);
        background: linear-gradient(to top, rgba(0, 0, 0, 0.22), transparent);
      }

      /* Scrollbar on dark surface. */
      .pr-sheet-body::-webkit-scrollbar { width: 10px; }
      .pr-sheet-body::-webkit-scrollbar-thumb {
        background: rgba(255, 255, 255, 0.1);
        border-radius: 999px;
        border: 3px solid transparent;
        background-clip: padding-box;
      }
      .pr-sheet-body::-webkit-scrollbar-thumb:hover {
        background: rgba(255, 255, 255, 0.18);
        background-clip: padding-box;
      }

      @media (prefers-reduced-motion: reduce) {
        .pr-sheet-overlay, .pr-sheet-panel { transition: none; }
        .pr-sheet-panel { transform: none; }
      }
    `}</style>
  );
}

/* ------------------------------------------------------------------------- */
/* Small presentational helpers for sheet contents — not required, but using */
/* them keeps every sheet reading the same way.                              */
/* ------------------------------------------------------------------------- */

export function SheetField({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div>
      <div
        className="text-[10px] font-semibold tracking-[0.14em] uppercase"
        style={{ color: "rgba(245,247,250,0.5)" }}
      >
        {label}
      </div>
      <div className="mt-1.5 text-[13.5px]" style={{ color: "#F5F7FA" }}>
        {children}
      </div>
    </div>
  );
}

export function SheetDivider() {
  return (
    <div
      className="h-px"
      style={{ background: "rgba(255,255,255,0.06)" }}
      aria-hidden
    />
  );
}

/** Primary filled action for the sheet footer (coral). */
export function SheetPrimaryLink({
  to,
  children,
}: {
  to: string;
  children: ReactNode;
}) {
  return (
    <Link
      to={to}
      className="hub-sheet-primary inline-flex items-center justify-center gap-2 rounded-full px-4 py-2 text-[13px] font-semibold transition-opacity hover:opacity-90"
      style={{ background: "var(--hub-yellow, #FF8B81)", color: "var(--hub-surface, #0B1726)" }}
    >
      {children}
    </Link>
  );
}

/** Quiet secondary action for the sheet footer. */
export function SheetSecondaryLink({
  to,
  children,
}: {
  to: string;
  children: ReactNode;
}) {
  return (
    <Link
      to={to}
      className="hub-sheet-secondary inline-flex items-center justify-center gap-2 rounded-full px-4 py-2 text-[13px] font-medium transition-colors hover:bg-white/5"
      style={{
        color: "rgba(245,247,250,0.75)",
        border: "1px solid rgba(255,255,255,0.12)",
      }}
    >
      {children}
    </Link>
  );
}
