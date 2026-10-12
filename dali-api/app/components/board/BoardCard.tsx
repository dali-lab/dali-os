// The card shell every kanban uses: accent edge, drag surface, click-to-open
// body, and the borderless icon+value meta items on its bottom line. Boards
// supply the content; this keeps the task board and the partner CRM board
// reading as one system.

import type { ReactNode } from "react";
import { Tooltip } from "~/components/ui/floating";
import { useOsChrome } from "~/components/os-chrome";
import { cn } from "~/lib/cn";

export const boardMetaText = (os: boolean) => (os ? "text-xs" : "text-[11px]");

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
  const { os } = useOsChrome();
  return (
    <div
      {...dragHandleProps}
      data-testid={testId}
      style={{ borderLeftColor: accentEdge }}
      className={cn(
        "relative border border-l-4 flex focus-within:ring-2",
        os
          ? "rounded-os-item border-transparent bg-os-well text-[15px] focus-within:ring-os-accent/40"
          : "rounded-md border-border bg-background text-sm focus-within:ring-accent-coral/30",
        isDragging ? "opacity-40" : os ? "hover:bg-os-container/60" : "hover:bg-muted/20",
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
        className={cn(
          "flex-1 min-w-0 text-left cursor-pointer focus:outline-none",
          os ? "p-3" : "p-2.5",
        )}
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
  const { os } = useOsChrome();
  return (
    <div
      className={cn(
        "mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-muted-foreground",
        boardMetaText(os),
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
  const { os } = useOsChrome();
  const toneClass = os
    ? {
        neutral: "border-transparent bg-os-container text-muted-foreground",
        accent: "border-transparent bg-os-accent/15 text-os-accent",
        warn: "border-transparent bg-os-amber/15 text-os-amber",
        good: "border-transparent bg-os-green/15 text-os-green",
        bad: "border-transparent bg-destructive/10 text-destructive",
      }[tone]
    : {
        neutral: "border-border bg-muted text-muted-foreground",
        accent: "border-blue-100 bg-blue-50 text-blue-700",
        warn: "border-amber-200 bg-amber-50 text-amber-800",
        good: "border-emerald-200 bg-emerald-50 text-emerald-800",
        bad: "border-red-200 bg-red-50 text-red-700",
      }[tone];
  return (
    <Tooltip content={title ?? null}>
      <span
        className={cn(
          "inline-flex items-center gap-1 px-1.5 py-0.5 border font-medium",
          os ? "rounded-full" : "rounded-md",
          toneClass,
        )}
      >
        {icon}
        {children}
      </span>
    </Tooltip>
  );
}
