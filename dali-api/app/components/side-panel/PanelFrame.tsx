import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { ChevronsRight, Maximize2 } from "lucide-react";
import { isInFloatingLayer, Tooltip } from "~/components/ui/floating";
import { OverflowMenu } from "~/components/shell/OverflowMenu";
import { PageBarSlotProvider, usePageBarTargetSetters } from "~/components/shell/page-bar-slot";
import { cn } from "~/lib/cn";
import { sidePanelHref, type SidePanel } from "~/lib/side-panel";

export const SIDE_PANEL_WIDTH_VAR = "--side-panel-w";
const SHARE_KEY = "dali:side-panel:share";
const PRE_MEASURE_WIDTH = 520;
const MIN_WIDTH = 360;
const MIN_PAGE_WIDTH = 480;
const DEFAULT_SHARE = 0.45;
const MAX_SHARE = 0.6;

export function clampPanelWidth(width: number, viewport: number): number {
  return Math.round(Math.max(MIN_WIDTH, Math.min(width, viewport * MAX_SHARE)));
}

/** The width before anyone drags: a share of the window that leaves the page a usable column beside it. */
export function defaultPanelWidth(viewport: number, rowWidth: number): number {
  return clampPanelWidth(Math.min(viewport * DEFAULT_SHARE, rowWidth - MIN_PAGE_WIDTH), viewport);
}

export function parsePanelShare(saved: string | null): number | null {
  const share = Number(saved);
  return saved && Number.isFinite(share) && share > 0 && share <= 1 ? share : null;
}

function readShare(): number | null {
  try {
    return parsePanelShare(window.localStorage.getItem(SHARE_KEY));
  } catch {
    return null;
  }
}

function editingElement(el: Element | null): HTMLElement | null {
  if (!(el instanceof HTMLElement)) return null;
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return el;
  return el.closest<HTMLElement>('[contenteditable=""], [contenteditable="true"]');
}

const HEADER_BUTTON =
  "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-os-grey transition-colors hover:bg-os-hover hover:text-foreground";

export function PanelFrame(props: {
  panel: SidePanel;
  title: string;
  icon?: string | null;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <PageBarSlotProvider>
      <PanelFrameInner {...props} />
    </PageBarSlotProvider>
  );
}

function PanelFrameInner({
  panel,
  title,
  icon = null,
  onClose,
  children,
}: {
  panel: SidePanel;
  title: string;
  icon?: string | null;
  onClose: () => void;
  children: ReactNode;
}) {
  const { actionsRef } = usePageBarTargetSetters();
  const fullPage = sidePanelHref(panel);
  const [width, setWidth] = useState(PRE_MEASURE_WIDTH);
  const asideRef = useRef<HTMLElement>(null);
  const dragRef = useRef<{ startX: number; startW: number } | null>(null);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || isInFloatingLayer(document.activeElement)) return;
      const editing = editingElement(document.activeElement);
      if (editing) {
        editing.blur();
        return;
      }
      onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  useLayoutEffect(() => {
    const fit = () => {
      const viewport = window.innerWidth;
      const share = readShare();
      const rowWidth = asideRef.current?.parentElement?.clientWidth ?? viewport;
      setWidth(share ? clampPanelWidth(share * viewport, viewport) : defaultPanelWidth(viewport, rowWidth));
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty(SIDE_PANEL_WIDTH_VAR, `${width}px`);
    return () => {
      root.style.removeProperty(SIDE_PANEL_WIDTH_VAR);
    };
  }, [width]);

  const onPointerDown = (e: React.PointerEvent) => {
    dragRef.current = { startX: e.clientX, startW: width };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    setWidth(clampPanelWidth(drag.startW + drag.startX - e.clientX, window.innerWidth));
  };
  const onPointerUp = () => {
    if (!dragRef.current) return;
    dragRef.current = null;
    try {
      window.localStorage.setItem(SHARE_KEY, String(width / window.innerWidth));
    } catch {
      // the width just won't be remembered
    }
  };

  return (
    <aside
      ref={asideRef}
      aria-label={title || "Side panel"}
      style={{ "--side-panel-w": `${width}px` } as React.CSSProperties}
      className={cn(
        "fixed inset-0 z-40 flex flex-col bg-os-bg",
        "md:sticky md:inset-auto md:top-0 md:z-auto md:h-dvh md:w-[var(--side-panel-w)] md:shrink-0 md:border-l md:border-border md:shadow-[-8px_0_24px_var(--color-os-hover)]",
      )}
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize side panel"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        className="absolute inset-y-0 -left-1 z-10 hidden w-2 cursor-col-resize md:block"
      />
      <div className="flex h-11 shrink-0 items-center gap-1 px-2">
        <Tooltip
          content={
            <>
              Close <span className="ml-1 opacity-70">Esc</span>
            </>
          }
        >
          <button type="button" aria-label="Close panel" onClick={onClose} className={HEADER_BUTTON}>
            <ChevronsRight className="h-[18px] w-[18px]" aria-hidden />
          </button>
        </Tooltip>
        {fullPage && (
          <Tooltip content="Open full page">
            <Link to={fullPage} aria-label="Open full page" className={HEADER_BUTTON}>
              <Maximize2 className="h-4 w-4" aria-hidden />
            </Link>
          </Tooltip>
        )}
        {(icon || title) && (
          <span className="ml-1 flex min-w-0 items-center gap-1.5 text-[13px] text-os-grey">
            {icon && <span aria-hidden className="shrink-0">{icon}</span>}
            <span className="truncate">{title}</span>
          </span>
        )}
        <div className="flex-1" />
        <div ref={actionsRef} className="flex items-center gap-1 empty:hidden" />
        <OverflowMenu />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">{children}</div>
    </aside>
  );
}

