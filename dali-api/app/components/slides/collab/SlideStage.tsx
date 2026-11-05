import { useEffect, useMemo, useRef, useState } from "react";
import { Maximize, MessageSquarePlus, Minus, Plus, RotateCcw } from "lucide-react";
import { Button } from "~/components/ui/Button";
import { IconButton } from "~/components/ui/IconButton";
import { slideFragment } from "~/components/slides/deck/deck-ops";
import { SlideRender } from "~/components/slides/deck/SlideRender";
import { placedStyle, u } from "~/components/slides/deck/units";
import { selectionTarget, withPlacements, type PlacedLive } from "~/components/slides/deck/freeform";
import { STAGE_H, STAGE_W, type LayoutSlot } from "~/components/slides/deck/layouts";
import type { RenderElement, RenderSlide } from "~/components/slides/deck/snapshot";
import { ContextMenu, MenuItem } from "~/components/ui/floating";
import { ActionMenuItems } from "./ActionMenuItems";
import { elementActions, stageActions, type ActionSpec, type ElementHandlers, type StageHandlers } from "./actions";
import { FormatBar, type FormatBarHandlers } from "./FormatBar";
import { placeCaretAt } from "./text-format";
import { clampZoom, clientToUnits, pinchZoom, zoomIn, zoomKey, zoomLabel, zoomOut } from "./zoom";
import { CommentPins } from "./CommentPins";
import { hasFiles, imageFilesOf } from "./drop-images";
import { FreeformLayer, type ArmedTool } from "./FreeformLayer";
import type { SnapPrefs } from "./snap-prefs";
import { elementAtPoint, type CommentPin } from "./comment-pins";
import type { CommentTarget } from "./SlideCommentsPanel";
import { SlotEditor, type SlotCollab } from "./SlotEditor";
import type * as Y from "yjs";

/** Editors remount when the slide changes or a restore replaces the deck's fragments. */
export const stageKey = (epoch: number, slideId: string) => `${epoch}:${slideId}`;

/** The biggest 16:9 box that fits its parent, scaled by `zoom`. When it outgrows the parent the parent scrolls. */
export function FitBox({ children, zoom = 1, onZoom }: { children: (width: number) => React.ReactNode; zoom?: number; onZoom?: (zoom: number) => void }) {
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
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  useEffect(() => {
    const el = ref.current;
    if (!el || !onZoom) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      onZoom(pinchZoom(zoomRef.current, e.deltaY));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [onZoom]);
  const scaled = Math.round(width * zoom);
  return (
    <div ref={ref} data-fit-box className="flex min-h-0 flex-1 overflow-auto">
      {width > 0 && (
        <div className="m-auto shrink-0" style={{ width: scaled }}>
          {children(scaled)}
        </div>
      )}
    </div>
  );
}

function ZoomControl({ zoom, onZoom }: { zoom: number; onZoom: (zoom: number) => void }) {
  return (
    <div role="group" aria-label="Zoom" className="absolute bottom-3 right-3 z-10 flex items-center gap-0.5 rounded-os-card border border-os-container bg-os-card p-0.5 shadow-sm">
      <IconButton label="Zoom out" icon={Minus} onClick={() => onZoom(zoomOut(zoom))} />
      <button type="button" aria-label="Fit to window" onClick={() => onZoom(1)} className="min-w-[3rem] rounded-md px-1 text-center text-xs tabular-nums text-os-grey hover:bg-os-hover">
        {zoomLabel(zoom)}
      </button>
      <IconButton label="Zoom in" icon={Plus} onClick={() => onZoom(zoomIn(zoom))} />
      <IconButton label="Fit to window" icon={Maximize} onClick={() => onZoom(1)} />
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
  menu,
  children,
}: {
  slide: RenderSlide;
  comments: StageComments | undefined;
  menu?: { actions: ActionSpec[]; onOpen: (e: React.MouseEvent<HTMLElement>) => void };
  children: React.ReactNode;
}) {
  const point = useRef({ x: 0.5, y: 0.5 });
  if (!comments && !menu) return <>{children}</>;
  const shell = (
    <div
      className="relative"
      onContextMenu={(e) => {
        const box = e.currentTarget.getBoundingClientRect();
        point.current = { x: (e.clientX - box.left) / box.width, y: (e.clientY - box.top) / box.height };
        menu?.onOpen(e);
      }}
    >
      {children}
      {comments && <CommentPins pins={comments.pins} focusedId={comments.focusedPinId} onOpen={comments.onOpenPin} />}
    </div>
  );
  if (menu) {
    return (
      <ContextMenu ariaLabel="Slide" items={<ActionMenuItems actions={menu.actions} />}>
        {shell}
      </ContextMenu>
    );
  }
  if (!comments || !comments.canComment) return shell;
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
  cropId: string | null;
  prefs: SnapPrefs;
  armed: ArmedTool | null;
  onPlace: (tool: ArmedTool, at: { x: number; y: number }) => void;
  onCommit: (updates: Record<string, PlacedLive>, opts?: { duplicate?: boolean }) => void;
  peerDrags: ReadonlyMap<string, PlacedLive>;
  onPublishDrag: (rects: Map<string, PlacedLive> | null) => void;
  onActivate: (id: string, clientPoint: { x: number; y: number }) => void;
  editPoint: React.MutableRefObject<{ x: number; y: number } | null>;
  onEscape: () => void;
  onGrow: (id: string, needed: number) => void;
  onContext: (target: string | null) => string[];
  handlers: ElementHandlers;
  stageHandlers: (at: { x: number; y: number }) => StageHandlers;
  barHandlers: FormatBarHandlers;
  canPaste: boolean;
  styleKind: "text" | "shape" | null;
  onDropFiles: (files: File[], at: { x: number; y: number }) => void;
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
  zoom = 1,
  onZoom,
}: {
  slide: RenderSlide;
  themeId: string;
  doc: Y.Doc;
  collab: SlotCollab | null;
  editable: boolean;
  freeform?: StageFreeform;
  onPickImage: (elementId?: string) => void;
  comments?: StageComments;
  zoom?: number;
  onZoom?: (zoom: number) => void;
}) {
  const [local, setLocal] = useState<Map<string, PlacedLive> | null>(null);
  const slide = useMemo(() => withPlacements(base, [freeform?.peerDrags, local]), [base, freeform?.peerDrags, local]);
  const selection = freeform?.selection ?? [];
  const onLive = (live: Map<string, PlacedLive> | null) => {
    setLocal(live);
    freeform?.onPublishDrag(live);
  };
  const stageRef = useRef<HTMLDivElement>(null);
  const editingId = freeform?.editingId ?? null;
  const editPoint = freeform?.editPoint;
  useEffect(() => {
    if (!editingId) return;
    let tries = 0;
    let frame = 0;
    const focus = () => {
      const el = stageRef.current?.querySelector<HTMLElement>(`[data-element-id="${CSS.escape(editingId)}"] [contenteditable="true"]`);
      if (el) {
        if (document.activeElement !== el) el.focus();
        if (editPoint?.current) {
          placeCaretAt(el, editPoint.current);
          editPoint.current = null;
        }
      } else if (tries++ < 30) frame = requestAnimationFrame(focus);
    };
    focus();
    return () => cancelAnimationFrame(frame);
  }, [editingId, editPoint]);

  const [menuTarget, setMenuTarget] = useState<{ kind: "element" } | { kind: "stage"; at: { x: number; y: number } }>({ kind: "stage", at: { x: STAGE_W / 2, y: STAGE_H / 2 } });
  const layerPoint = (e: { clientX: number; clientY: number; currentTarget: Element }) => {
    const layer = e.currentTarget.querySelector("[data-freeform-layer]") ?? e.currentTarget;
    return clientToUnits({ x: e.clientX, y: e.clientY }, layer.getBoundingClientRect(), { w: STAGE_W, h: STAGE_H });
  };
  const actionContext = freeform && {
    slide,
    selection,
    canPaste: freeform.canPaste,
    styleClip: freeform.styleKind,
    canComment: Boolean(comments?.canComment),
    handlers: freeform.handlers,
  };
  const menuActions: ActionSpec[] =
    !freeform || !actionContext
      ? []
      : menuTarget.kind === "element" && selection.length > 0
        ? elementActions(actionContext)
        : stageActions({
            layoutId: slide.layoutId,
            canPaste: freeform.canPaste,
            canComment: Boolean(comments?.canComment),
            guides: freeform.prefs.items && freeform.prefs.margins,
            grid: freeform.prefs.grid,
            handlers: freeform.stageHandlers(menuTarget.kind === "stage" ? menuTarget.at : { x: STAGE_W / 2, y: STAGE_H / 2 }),
          });
  const menu =
    editable && collab && freeform
      ? {
          actions: menuActions,
          onOpen: (e: React.MouseEvent<HTMLElement>) => {
            const hit = (e.target as HTMLElement).closest<HTMLElement>("[data-hit]")?.dataset.hit;
            if (hit) {
              freeform.onContext(selectionTarget(slide, hit));
              setMenuTarget({ kind: "element" });
            } else {
              freeform.onContext(null);
              setMenuTarget({ kind: "stage", at: layerPoint(e) });
            }
          },
        }
      : undefined;

  const commentButton = (elementId: string, placed: PlacedLive) =>
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
    <div
      className="relative flex min-h-0 flex-1 flex-col"
      onDragOver={(e) => {
        if (menu && hasFiles(e.dataTransfer)) e.preventDefault();
      }}
      onDrop={(e) => {
        if (!menu || !freeform) return;
        const files = imageFilesOf(e.dataTransfer);
        if (files.length === 0) return;
        e.preventDefault();
        freeform.onDropFiles(files, layerPoint(e));
      }}
    >
    <FitBox zoom={zoom} onZoom={onZoom}>
      {() => (
        <CommentableStage slide={slide} comments={comments} menu={menu}>
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
                      onEscape={freeform?.onEscape}
                      grow={freeform && !element.hFixed && !element.locked && editingId === element.id ? (needed) => freeform.onGrow(element.id, needed) : undefined}
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
                      onEscape={freeform?.onEscape}
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
              onActivate={freeform.onActivate}
              cropId={freeform.cropId}
              renderBar={({ single, editing, cropping }) =>
                editing || freeform.armed || !actionContext ? null : (
                  <FormatBar element={single} actions={elementActions(actionContext)} themeId={themeId} cropping={cropping} handlers={freeform.barHandlers} />
                )
              }
            />
          )}
        </CommentableStage>
      )}
    </FitBox>
    {onZoom && <ZoomControl zoom={zoom} onZoom={onZoom} />}
    </div>
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
