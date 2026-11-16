// The card shell every kanban uses: accent edge, drag surface, click-to-open
// body, and the borderless icon+value meta items on its bottom line. Boards
// supply the content; this keeps the task board and the partner CRM board
// reading as one system.

import type { ReactNode } from "react";
import { Tooltip } from "~/components/ui/floating";
import { cn } from "~/lib/cn";

const BOARD_META_TEXT = "text-xs";

export function BoardCard({
  accentEdge,
  dragHandleProps = {},
  isDragging,
  onOpen,
  testId,
  children,
}: {
  // CSS colour value for the left border (see status-accent.ts).
  accentEdge: string;
  dragHandleProps?: Record<string, unknown>;
  isDragging: boolean;
  onOpen: () => void;
  testId?: string;
  children: ReactNode;
}) {
  return (
    <div
      {...dragHandleProps}
      data-testid={testId}
      style={{ borderLeftColor: accentEdge }}
      className={cn(
        "relative flex rounded-os-item border border-l-4 border-transparent bg-os-bg text-[15px] focus-within:ring-2 focus-within:ring-os-accent/40",
        isDragging ? "opacity-40" : "hover:bg-os-container/60",
      )}
    >
      <div
        role="button"
        tabIndex={0}
        onClick={onOpen}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onOpen();
          }
        }}
        className="flex-1 min-w-0 cursor-pointer p-3 text-left focus:outline-none"
      >
        {children}
      </div>
    </div>
  );
}

// One fact on the card's bottom line: an icon and its value, nothing else.
// Borderless on purpose — a row of bordered pills competes with the title,
// and these are counts, not labels.
export function BoardCardMeta({
  icon,
  title,
  className,
  children,
}: {
  icon: ReactNode;
  title?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Tooltip content={title ?? null}>
      <span className={cn("inline-flex items-center gap-1", className)}>
        {icon}
        {children}
      </span>
    </Tooltip>
  );
}

// The meta row container under a card title.
export function BoardCardMetaRow({ children }: { children: ReactNode }) {
  return (
    <div
      className={cn(
        "mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-muted-foreground",
        BOARD_META_TEXT,
      )}
    >
      {children}
    </div>
  );
}

// A small labelled chip on the meta row (Blocked, Paused, Project, a domain).
export function BoardCardChip({
  tone = "neutral",
  icon,
  title,
  children,
}: {
  tone?: "neutral" | "accent" | "warn" | "good" | "bad";
  icon?: ReactNode;
  title?: string;
  children: ReactNode;
}) {
  const toneClass = {
    neutral: "border-transparent bg-os-container text-muted-foreground",
    accent: "border-transparent bg-os-accent/15 text-os-accent",
    warn: "border-transparent bg-os-amber/15 text-os-amber",
    good: "border-transparent bg-os-green/15 text-os-green",
    bad: "border-transparent bg-destructive/10 text-destructive",
  }[tone];
  return (
    <Tooltip content={title ?? null}>
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 border font-medium",
          toneClass,
        )}
      >
        {icon}
        {children}
      </span>
    </Tooltip>
  );
}
