import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { ChevronsRight, Maximize2 } from "lucide-react";
import { isInFloatingLayer, Tooltip } from "~/components/ui/floating";
import { OverflowMenu } from "~/components/shell/OverflowMenu";
import { PageBarSlotProvider, usePageBarTargetSetters } from "~/components/shell/page-bar-slot";
import { cn } from "~/lib/cn";
import { sidePanelHref, type SidePanel } from "~/lib/side-panel";

export const SIDE_PANEL_WIDTH_VAR = "--side-panel-w";
const WIDTH_KEY = "dali:side-panel:width";
const DEFAULT_WIDTH = 520;
const MIN_WIDTH = 360;

export function clampPanelWidth(width: number, viewport: number): number {
  return Math.round(Math.max(MIN_WIDTH, Math.min(width, viewport * 0.6)));
}

function readWidth(): number {
  try {
    const saved = Number(window.localStorage.getItem(WIDTH_KEY));
    return Number.isFinite(saved) && saved > 0 ? saved : DEFAULT_WIDTH;
  } catch {
    return DEFAULT_WIDTH;
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
  const [width, setWidth] = useState(DEFAULT_WIDTH);
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

  useEffect(() => {
    setWidth(clampPanelWidth(readWidth(), window.innerWidth));
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
      window.localStorage.setItem(WIDTH_KEY, String(width));
    } catch {
      // the width just won't be remembered
    }
  };

  return (
    <aside
      aria-label={title || "Side panel"}
      style={{ "--side-panel-w": `${width}px` } as React.CSSProperties}
      className={cn(
        "fixed inset-0 z-40 flex flex-col bg-os-card",
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
        <Tooltip content="Open full page">
          <Link to={sidePanelHref(panel)} aria-label="Open full page" className={HEADER_BUTTON}>
            <Maximize2 className="h-4 w-4" aria-hidden />
          </Link>
        </Tooltip>
        {(icon || title) && (
          <span className="ml-1 flex min-w-0 items-center gap-1.5 text-[13px] text-os-muted">
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

