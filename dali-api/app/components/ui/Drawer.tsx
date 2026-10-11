import { useId, type ReactNode } from "react";
import { X } from "lucide-react";
import { Modal } from "~/components/Modal";
import { IconButton } from "~/components/ui/IconButton";
import { cn } from "~/lib/cn";

// A right-edge sliding panel — a Modal variant, so Escape and focus trapping
// come for free. Extracted from TasksDrawer (AttentionPanel.tsx); the
// Recording rail's narrow-canvas states use this too
// (specs/meeting-recording-rail.md).

export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  /** Omit when `children` render their own header (e.g. RecordingRail,
   *  which already has a title + Close) — pass `labelledBy` instead so the
   *  dialog still has an accessible name; Drawer then renders no header
   *  of its own. */
  title?: ReactNode;
  /** Extra header controls before Close (e.g. "See all"). Ignored when
   *  `title` is omitted. */
  headerActions?: ReactNode;
  /** Required when `title` is omitted. */
  labelledBy?: string;
  children: ReactNode;
  /** Pinned below the scrollable body — action rows, not more content. */
  footer?: ReactNode;
  width?: 360 | 480;
}

export function Drawer({ open, onClose, title, headerActions, labelledBy, children, footer, width = 480 }: DrawerProps) {
  const generatedId = useId();
  const titleId = title !== undefined ? generatedId : labelledBy ?? generatedId;
  return (
    <Modal
      open={open}
      onClose={onClose}
      labelledBy={titleId}
      className="fixed inset-0 z-50 flex justify-end bg-os-overlay"
      containerClassName={cn(
        "flex h-full w-full flex-col border-l border-os-container bg-os-card shadow-[-24px_0_60px_var(--color-os-shadow)] outline-none motion-safe:animate-detail-panel",
        width === 360 ? "max-w-[360px]" : "max-w-[480px]",
      )}
    >
      {title !== undefined && (
        <div className="flex items-center gap-2 px-6 pt-6 pb-4">
          <h2 id={titleId} className="flex-1 text-lg font-bold text-foreground">
            {title}
          </h2>
          {headerActions}
          <IconButton label="Close" icon={X} onClick={onClose} className="h-9 w-9" iconClassName="h-5 w-5" />
        </div>
      )}
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
      {footer && <div className="shrink-0 border-t border-os-container px-5 py-3.5">{footer}</div>}
    </Modal>
  );
}
