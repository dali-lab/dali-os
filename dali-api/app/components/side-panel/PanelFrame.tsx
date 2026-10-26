import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { Maximize2, X } from "lucide-react";
import { IconButton } from "~/components/ui/IconButton";
import { cn } from "~/lib/cn";
import { sidePanelHref, type SidePanel } from "~/lib/side-panel";

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

export function PanelFrame({
  panel,
  title,
  onClose,
  children,
}: {
  panel: SidePanel;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const dragRef = useRef<{ startX: number; startW: number } | null>(null);

  useEffect(() => {
    setWidth(clampPanelWidth(readWidth(), window.innerWidth));
  }, []);

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
        "fixed inset-0 z-40 flex flex-col bg-os-bg",
        "md:sticky md:inset-auto md:top-0 md:z-auto md:h-dvh md:w-[var(--side-panel-w)] md:shrink-0 md:border-l md:border-border",
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
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3">
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{title}</span>
        <Link
          to={sidePanelHref(panel)}
          aria-label="Open as page"
          title="Open as page"
          className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted/50 hover:text-foreground"
        >
          <Maximize2 className="h-4 w-4" />
        </Link>
        <IconButton label="Close panel" icon={X} onClick={onClose} />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">{children}</div>
    </aside>
  );
}

