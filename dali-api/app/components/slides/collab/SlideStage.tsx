import { useEffect, useMemo, useRef, useState } from "react";
import { MessageSquarePlus, RotateCcw } from "lucide-react";
import { Button } from "~/components/ui/Button";
import { slideFragment } from "~/components/slides/deck/deck-ops";
import { SlideRender } from "~/components/slides/deck/SlideRender";
import { placedStyle, u } from "~/components/slides/deck/units";
import { withPlacements, type Placed } from "~/components/slides/deck/freeform";
import { STAGE_H, STAGE_W, type LayoutSlot } from "~/components/slides/deck/layouts";
import type { RenderElement, RenderSlide } from "~/components/slides/deck/snapshot";
import { ContextMenu, MenuItem } from "~/components/ui/floating";
import { CommentPins } from "./CommentPins";
import { FreeformLayer, type ArmedTool } from "./FreeformLayer";
import type { SnapPrefs } from "./snap-prefs";
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
            const elementId = elementAtPoint(slide.layoutId, x, y, slide);
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

export interface StageFreeform {
  selection: string[];
  onSelect: (ids: string[]) => void;
  editingId: string | null;
  onEdit: (id: string | null) => void;
  prefs: SnapPrefs;
  armed: ArmedTool | null;
  onPlace: (tool: ArmedTool, at: { x: number; y: number }) => void;
  onCommit: (updates: Record<string, Placed>) => void;
  peerDrags: ReadonlyMap<string, Placed>;
  onPublishDrag: (rects: Map<string, Placed> | null) => void;
}

export function SlideStage({
  slide: base,
  themeId,
  doc,
  collab,
  editable,
  freeform,
  onPickImage,
  comments,
}: {
  slide: RenderSlide;
  themeId: string;
  doc: Y.Doc;
  collab: SlotCollab | null;
  editable: boolean;
  freeform?: StageFreeform;
  onPickImage: (elementId?: string) => void;
  comments?: StageComments;
}) {
  const [local, setLocal] = useState<Map<string, Placed> | null>(null);
  const slide = useMemo(() => withPlacements(base, [freeform?.peerDrags, local]), [base, freeform?.peerDrags, local]);
  const selection = freeform?.selection ?? [];
  const onLive = (live: Map<string, Placed> | null) => {
    setLocal(live);
    freeform?.onPublishDrag(live);
  };
  const stageRef = useRef<HTMLDivElement>(null);
  const editingId = freeform?.editingId ?? null;
  useEffect(() => {
    if (!editingId) return;
    let tries = 0;
    let frame = 0;
    const focus = () => {
      const el = stageRef.current?.querySelector<HTMLElement>(`[data-element-id="${CSS.escape(editingId)}"] [contenteditable="true"]`);
      if (el) {
        if (document.activeElement !== el) el.focus();
      } else if (tries++ < 30) frame = requestAnimationFrame(focus);
    };
    focus();
    return () => cancelAnimationFrame(frame);
  }, [editingId]);

  const commentButton = (elementId: string, placed: Placed) =>
    comments?.canComment && selection.length === 1 && selection[0] === elementId ? (
      <button
        type="button"
        aria-label={`Comment on ${elementId}`}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => comments.onStart({ slideId: slide.id, elementId })}
        className="absolute flex items-center justify-center rounded-full bg-os-accent text-os-bg"
        style={{ left: u(placed.x + placed.w - 28), top: u(placed.y - 28), width: u(56), height: u(56), zIndex: 6 }}
      >
        <MessageSquarePlus style={{ width: u(32), height: u(32) }} aria-hidden />
      </button>
    ) : null;

  const commentScope = (elementId: string) =>
    comments
      ? {
          pageId: comments.pageId,
          currentUserId: comments.viewerId,
          canComment: comments.canComment,
          canModerate: comments.canModerate,
          scope: { slideId: slide.id, elementId },
        }
      : undefined;

  return (
    <FitBox>
      {() => (
        <CommentableStage slide={slide} comments={comments}>
          <div ref={stageRef}>
            <SlideRender
              className="rounded-os-card shadow-sm"
              slide={slide}
              theme={themeId}
              placeholders={editable}
              renderFree={({ element, placed, fallback }) => {
                const label = buildBadgeLabel(element);
                const badge = label ? <BuildBadge rect={placed} label={label} /> : null;
                if (!editable || !collab || element.kind !== "text") return <>{fallback}{badge}</>;
                const fragment = slideFragment(doc, slide.id, element.id);
                if (!fragment) return <>{fallback}{badge}</>;
                return (
                  <>
                    <SlotEditor
                      slot={{ slot: element.id as LayoutSlot["slot"], kind: "text", rect: placed, style: element.textStyle ?? "body", align: "left", valign: "top", placeholder: "Text" }}
                      style={element.textStyle ?? "body"}
                      fragment={fragment}
                      collab={collab}
                      selected={selection.includes(element.id)}
                      onFocus={() => (freeform?.onSelect([element.id]), freeform?.onEdit(element.id))}
                      onBlur={() => freeform?.onEdit(null)}
                      elementId={element.id}
                      rot={placed.rot}
                      comments={commentScope(element.id)}
                    />
                    {badge}
                    {commentButton(element.id, placed)}
                  </>
                );
              }}
              renderSlot={({ slot, element, placed, fallback }) => {
                const label = buildBadgeLabel(element);
                const badge = label ? <BuildBadge rect={placed} label={label} /> : null;
                if (!editable || !collab) return <>{fallback}{badge}</>;
                if (slot.kind === "image") {
                  return (
                    <>
                      {fallback}
                      {badge}
                      <button
                        type="button"
                        aria-label={element?.src ? "Replace image" : "Add image"}
                        onClick={() => onPickImage()}
                        className="absolute opacity-0"
                        style={placedStyle(placed)}
                      />
                    </>
                  );
                }
                const fragment = slideFragment(doc, slide.id, slot.slot);
                if (!fragment) return <>{fallback}{badge}</>;
                return (
                  <>
                    <SlotEditor
                      slot={{ ...slot, rect: placed }}
                      style={element?.textStyle ?? slot.style}
                      fragment={fragment}
                      collab={collab}
                      selected={selection.includes(slot.slot)}
                      onFocus={() => (freeform?.onSelect([slot.slot]), freeform?.onEdit(slot.slot))}
                      onBlur={() => freeform?.onEdit(null)}
                      rot={placed.rot}
                      comments={commentScope(element?.id ?? slot.slot)}
                    />
                    {badge}
                    {commentButton(element?.id ?? slot.slot, placed)}
                  </>
                );
              }}
            />
          </div>
          {editable && collab && freeform && (
            <FreeformLayer
              slide={slide}
              selection={freeform.selection}
              onSelect={freeform.onSelect}
              editingId={freeform.editingId}
              onEdit={freeform.onEdit}
              prefs={freeform.prefs}
              armed={freeform.armed}
              onPlace={freeform.onPlace}
              onLive={onLive}
              onCommit={freeform.onCommit}
              onActivate={(id) => {
                const el = slide.elements.find((e) => e.id === id);
                if (el?.kind === "image") onPickImage(id);
              }}
            />
          )}
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
