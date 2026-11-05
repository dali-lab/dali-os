import { useEffect, useRef, useState } from "react";
import { MessageSquarePlus, RotateCcw } from "lucide-react";
import { Button } from "~/components/ui/Button";
import { slideFragment } from "~/components/slides/deck/deck-ops";
import { SlideRender } from "~/components/slides/deck/SlideRender";
import { rectStyle, u } from "~/components/slides/deck/units";
import { STAGE_H, STAGE_W, type LayoutSlot } from "~/components/slides/deck/layouts";
import type { RenderElement, RenderSlide } from "~/components/slides/deck/snapshot";
import { ContextMenu, MenuItem } from "~/components/ui/floating";
import { CommentPins } from "./CommentPins";
import { elementAtPoint, type CommentPin } from "./comment-pins";
import type { CommentTarget } from "./SlideCommentsPanel";
import { SlotEditor, type SlotCollab } from "./SlotEditor";
import type * as Y from "yjs";

/** Editors remount when the slide changes or a restore replaces the deck's fragments. */
export const stageKey = (epoch: number, slideId: string) => `${epoch}:${slideId}`;

/** The biggest 16:9 box that fits its parent. */
export function FitBox({ children }: { children: (width: number) => React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setWidth(Math.max(0, Math.floor(Math.min(el.clientWidth, (el.clientHeight * STAGE_W) / STAGE_H))));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={ref} className="flex min-h-0 flex-1 items-center justify-center">
      {width > 0 && <div style={{ width }}>{children(width)}</div>}
    </div>
  );
}

export const buildBadgeLabel = (element: RenderElement | undefined): string | null => {
  if (!element) return null;
  const parts = [element.build ? `Step ${element.build}` : null, element.buildBullets ? "bullets" : null].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
};

function BuildBadge({ rect, label }: { rect: LayoutSlot["rect"]; label: string }) {
  return (
    <span
      data-build-badge
      className="pointer-events-none absolute rounded-full bg-os-accent font-semibold text-os-bg"
      style={{ left: u(rect.x + 8), top: u(rect.y + 8), fontSize: u(26), padding: `${u(4)} ${u(16)}`, zIndex: 5 }}
    >
      {label}
    </span>
  );
}

export interface StageComments {
  pageId: string;
  viewerId: string;
  canComment: boolean;
  canModerate: boolean;
  pins: CommentPin[];
  focusedPinId: string | null;
  onOpenPin: (threadId: string) => void;
  onStart: (target: CommentTarget) => void;
}

/** Wraps the stage so a right click on it offers to comment at that point. */
export function CommentableStage({
  slide,
  comments,
  children,
}: {
  slide: RenderSlide;
  comments: StageComments | undefined;
  children: React.ReactNode;
}) {
  const point = useRef({ x: 0.5, y: 0.5 });
  if (!comments) return <>{children}</>;
  const shell = (
    <div
      className="relative"
      onContextMenu={(e) => {
        const box = e.currentTarget.getBoundingClientRect();
        point.current = { x: (e.clientX - box.left) / box.width, y: (e.clientY - box.top) / box.height };
      }}
    >
      {children}
      <CommentPins pins={comments.pins} focusedId={comments.focusedPinId} onOpen={comments.onOpenPin} />
    </div>
  );
  if (!comments.canComment) return shell;
  return (
    <ContextMenu
      ariaLabel="Comment"
      items={
        <MenuItem
          icon={<MessageSquarePlus className="h-4 w-4" aria-hidden />}
          onSelect={() => {
            const { x, y } = point.current;
            const elementId = elementAtPoint(slide.layoutId, x, y);
            comments.onStart({ slideId: slide.id, x, y, ...(elementId ? { elementId } : {}) });
          }}
        >
          Comment here
        </MenuItem>
      }
    >
      {shell}
    </ContextMenu>
  );
}

export function SlideStage({
  slide,
  themeId,
  doc,
  collab,
  editable,
  selectedSlot,
  onSelectSlot,
  onPickImage,
  comments,
}: {
  slide: RenderSlide;
  themeId: string;
  doc: Y.Doc;
  collab: SlotCollab | null;
  editable: boolean;
  selectedSlot: string | null;
  onSelectSlot: (slot: string) => void;
  onPickImage: () => void;
  comments?: StageComments;
}) {
  return (
    <FitBox>
      {() => (
        <CommentableStage slide={slide} comments={comments}>
        <SlideRender
          className="rounded-os-card shadow-sm"
            slide={slide}
            theme={themeId}
            placeholders={editable}
            renderSlot={({ slot, element, fallback }) => {
              const label = buildBadgeLabel(element);
              const badge = label ? <BuildBadge rect={slot.rect} label={label} /> : null;
              if (!editable || !collab) return <>{fallback}{badge}</>;
              if (slot.kind === "image") {
                return (
                  <>
                    {fallback}
                    {badge}
                    <button
                      type="button"
                      aria-label={element?.src ? "Replace image" : "Add image"}
                      onClick={onPickImage}
                      className="absolute opacity-0"
                      style={rectStyle(slot.rect)}
                    />
                  </>
                );
              }
              const fragment = slideFragment(doc, slide.id, slot.slot);
              if (!fragment) return <>{fallback}{badge}</>;
              return (
                <>
                  <SlotEditor
                    slot={slot}
                    style={element?.textStyle ?? slot.style}
                    fragment={fragment}
                    collab={collab}
                    selected={selectedSlot === slot.slot}
                    onFocus={() => onSelectSlot(slot.slot)}
                    comments={
                      comments
                        ? {
                            pageId: comments.pageId,
                            currentUserId: comments.viewerId,
                            canComment: comments.canComment,
                            canModerate: comments.canModerate,
                            scope: { slideId: slide.id, elementId: element?.id ?? slot.slot },
                          }
                        : undefined
                    }
                  />
                  {badge}
                  {comments?.canComment && selectedSlot === slot.slot && (
                    <button
                      type="button"
                      aria-label={`Comment on ${slot.slot}`}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => comments.onStart({ slideId: slide.id, elementId: element?.id ?? slot.slot })}
                      className="absolute flex items-center justify-center rounded-full bg-os-accent text-os-bg"
                      style={{ left: u(slot.rect.x + slot.rect.w - 28), top: u(slot.rect.y - 28), width: u(56), height: u(56), zIndex: 6 }}
                    >
                      <MessageSquarePlus style={{ width: u(32), height: u(32) }} aria-hidden />
                    </button>
                  )}
                </>
              );
            }}
          />
        </CommentableStage>
      )}
    </FitBox>
  );
}

export function DeletedSlideNotice({ by, onRestore }: { by: string | null; onRestore: () => void }) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center">
      <div role="status" className="flex items-center gap-3 rounded-os-card border border-os-container bg-os-card px-4 py-3 text-sm">
        <span>{by ? `Deleted by ${by}` : "This slide was deleted"}</span>
        <Button variant="secondary" size="sm" onClick={onRestore}>
          <RotateCcw className="h-3.5 w-3.5" aria-hidden />
          Restore
        </Button>
      </div>
    </div>
  );
}
