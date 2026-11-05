import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { parseClipboard, serializeSelection } from "~/components/slides/deck/clipboard";
import { resetToNatural } from "~/components/slides/deck/crop";
import { setBuild } from "~/components/slides/deck/deck-ops";
import { buildSteps } from "~/components/slides/deck/builds";
import {
  addChart,
  addCodeBlock,
  addEmoji,
  addIcon,
  addShape,
  addTable,
  addTextBox,
  addVideo,
  alignElements,
  applyStyle,
  deleteElements,
  distributeElements,
  duplicateElements,
  groupElements,
  moveElements,
  pasteItems,
  placementsOf,
  reorderElements,
  setAutoHeight,
  setChart,
  setCrop,
  setFill,
  setFreeTextStyle,
  setIconName,
  setLocked,
  setPlacements,
  setVideoUrl,
  snapBack,
  ungroupElements,
  type PlacedUpdate,
} from "~/components/slides/deck/freeform-ops";
import { selectionTarget, type PlacedLive } from "~/components/slides/deck/freeform";
import { nudgeDelta } from "~/components/slides/deck/geometry";
import type { ChartSpec, ChartType } from "~/components/slides/deck/content";
import { STAGE_H, STAGE_W } from "~/components/slides/deck/layouts";
import type { RenderSlide } from "~/components/slides/deck/snapshot";
import { getStyleClip, setStyleClip, styleOf } from "~/components/slides/deck/style-clip";
import type { ShapeKind } from "~/components/slides/deck/model";
import type { InsertItem } from "./InsertMenu";
import type { ArmedTool } from "./FreeformLayer";
import type { InspectorFreeform } from "./ElementInspector";
import type { CommentTarget } from "./SlideCommentsPanel";
import type { ElementHandlers, StageHandlers } from "./actions";
import { selectionFacts } from "./actions";
import { contextSelection, reduceEditing, type EditEvent, type EditState } from "./editing-model";
import { imageFilesOf } from "./drop-images";
import type { FormatBarHandlers } from "./FormatBar";
import { useSnapPrefs } from "./snap-prefs";
import type { StageFreeform } from "./SlideStage";
import { formatWholeText } from "./text-format";
import { useSlideDrags, type DeckDoc } from "./useDeckDoc";

const inEditable = (target: EventTarget | null) => Boolean((target as HTMLElement | null)?.closest?.("[contenteditable='true'], input, textarea, select"));

type At = { x: number; y: number };
type Point = At;

let clipMemory: string | null = null;

export async function writeClip(text: string): Promise<void> {
  clipMemory = text;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    return;
  }
}

export async function readClip(): Promise<string> {
  try {
    const text = await navigator.clipboard.readText();
    if (text) return text;
  } catch {
    return clipMemory ?? "";
  }
  return clipMemory ?? "";
}

export const canReadClip = (): boolean => clipMemory !== null || typeof navigator !== "undefined" && typeof navigator.clipboard?.readText === "function";

function naturalSize(src: string): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/** Each puts one element on the current slide as one undo step, selects it, and returns its id. */
export interface ContentInsert {
  text: (at: At) => void;
  shape: (shape: ShapeKind, at: At) => void;
  table: (at?: At) => string | null;
  code: (at?: At) => string | null;
  chart: (type: ChartType, at?: At) => string | null;
  icon: (name: string, at?: At) => string | null;
  emoji: (emoji: string, at?: At) => string | null;
  video: (url: string, at?: At) => string | null;
}

export interface FreeformExternal {
  pickReplace?: (id: string) => void;
  pickAt?: (at: Point | null) => void;
  insertAt?: (item: InsertItem, at: Point) => void;
  addImages?: (files: File[], at: Point | null) => void;
  comment?: (target: CommentTarget) => void;
  changeLayout?: (layoutId: string) => void;
}

export interface FreeformEditor {
  selection: string[];
  setSelection: (ids: string[]) => void;
  stage: StageFreeform;
  inspector: InspectorFreeform;
  armed: ArmedTool | null;
  arm: (tool: ArmedTool | null) => void;
  insert: ContentInsert;
}

const EMPTY: EditState = { selection: [], editingId: null, cropId: null };

/** Selection, the armed insert tool, and every freeform edit for the slide on screen. Each gesture is one undo step. */
export function useFreeformEditor({
  deck,
  slide,
  editable,
  external,
}: {
  deck: DeckDoc | null;
  slide: RenderSlide | null;
  editable: boolean;
  external?: FreeformExternal;
}): FreeformEditor {
  const [edit, setEdit] = useState<EditState>(EMPTY);
  const [armed, setArmed] = useState<ArmedTool | null>(null);
  const [styleKind, setStyleKind] = useState<"text" | "shape" | null>(() => getStyleClip()?.kind ?? null);
  const [prefs, onPrefs] = useSnapPrefs();
  const drags = useSlideDrags(deck, editable && slide ? slide.id : null);
  const slideId = slide?.id ?? null;
  const editPoint = useRef<Point | null>(null);

  useEffect(() => {
    setEdit(EMPTY);
    setArmed(null);
  }, [slideId]);

  const present = useMemo(() => new Set(slide?.elements.map((e) => e.id) ?? []), [slide]);
  const known = useRef<{ slideId: string | null; ids: Set<string> }>({ slideId: null, ids: new Set() });
  if (known.current.slideId !== slideId) known.current = { slideId, ids: new Set() };
  const seen = known.current.ids;
  const live = useMemo(() => edit.selection.filter((id) => present.has(id) || !seen.has(id)), [edit.selection, present, seen]);
  useEffect(() => {
    present.forEach((id) => seen.add(id));
  }, [present, seen]);
  useEffect(() => {
    if (live.length !== edit.selection.length) setEdit((s) => ({ ...s, selection: live }));
  }, [live, edit.selection.length]);
  useEffect(() => {
    if (edit.cropId && !(live.length === 1 && live[0] === edit.cropId)) setEdit((s) => ({ ...s, cropId: null }));
  }, [edit.cropId, live]);

  const latest = useRef({ deck, slide, selection: live, edit, external, prefs });
  latest.current = { deck, slide, selection: live, edit, external, prefs };

  const facts = useMemo(
    () => ({
      kindOf: (id: string) => slide?.elements.find((e) => e.id === id)?.kind,
      locked: (id: string) => Boolean(slide?.elements.find((e) => e.id === id)?.locked),
    }),
    [slide],
  );
  const factsRef = useRef(facts);
  factsRef.current = facts;
  const dispatch = useCallback((event: EditEvent) => setEdit((s) => reduceEditing({ ...s, selection: latest.current.selection }, event, factsRef.current)), []);

  const run = useCallback((fn: (deck: DeckDoc, slide: RenderSlide, ids: string[]) => void) => {
    const { deck: d, slide: s, selection: ids } = latest.current;
    if (!d || !s) return;
    d.undo.step(() => fn(d, s, ids));
  }, []);

  const setSelection = useCallback((ids: string[]) => setEdit((s) => ({ ...s, selection: ids })), []);
  const setEditing = useCallback((id: string | null) => setEdit((s) => ({ ...s, editingId: id })), []);

  const onCommit = useCallback(
    (updates: Record<string, PlacedLive>, opts?: { duplicate?: boolean }) =>
      run((d, s) => {
        if (!opts?.duplicate) return setPlacements(d.doc, s.id, updates as Record<string, PlacedUpdate>);
        const mapping = new Map<string, string>();
        const created = duplicateElements(d.doc, s.id, Object.keys(updates), 0, mapping);
        const moved: Record<string, PlacedUpdate> = {};
        for (const [from, to] of mapping) if (updates[from]) moved[to] = updates[from] as PlacedUpdate;
        setPlacements(d.doc, s.id, moved);
        if (created.length) setEdit((e) => ({ ...e, selection: created }));
      }),
    [run],
  );

  const onPlace = useCallback((tool: ArmedTool, at: Point) => {
    const { deck: d, slide: s } = latest.current;
    if (!d || !s) return;
    const id = d.undo.step(() => (tool.type === "text" ? addTextBox(d.doc, s.id, at) : addShape(d.doc, s.id, tool.shape, at)));
    setArmed(null);
    if (id) setEdit((e) => ({ ...e, selection: [id], editingId: tool.type === "text" ? id : null, cropId: null }));
  }, []);

  const copySelection = useCallback(async (cut: boolean) => {
    const { slide: s, selection: ids } = latest.current;
    if (!s || ids.length === 0) return;
    const text = serializeSelection(s, ids);
    if (!text) return;
    await writeClip(text);
    if (cut) run((d, sl, sel) => void deleteElements(d.doc, sl.id, sel));
  }, [run]);

  const pasteClipboard = useCallback(
    async (at?: Point) => {
      const items = parseClipboard(await readClip());
      if (!items) return;
      run((d, s) => {
        const next = pasteItems(d.doc, s.id, items, at ? { at } : undefined);
        if (next.length) setEdit((e) => ({ ...e, selection: next, editingId: null }));
      });
    },
    [run],
  );

  const handlers = useMemo<ElementHandlers>(
    () => ({
      cut: () => void copySelection(true),
      copy: () => void copySelection(false),
      paste: () => void pasteClipboard(),
      duplicate: () =>
        run((d, s, ids) => {
          const next = duplicateElements(d.doc, s.id, ids);
          if (next.length) setEdit((e) => ({ ...e, selection: next }));
        }),
      remove: () => run((d, s, ids) => void deleteElements(d.doc, s.id, ids)),
      copyStyle: () => {
        const { slide: s, selection: ids } = latest.current;
        const clip = s ? styleOf(selectionFacts(s, ids).single ?? undefined) : null;
        if (!clip) return;
        setStyleClip(clip);
        setStyleKind(clip.kind);
      },
      pasteStyle: () => {
        const clip = getStyleClip();
        if (clip) run((d, s, ids) => void applyStyle(d.doc, s.id, ids, clip));
      },
      reorder: (dir) => run((d, s, ids) => reorderElements(d.doc, s.id, ids, dir)),
      align: (mode, to) => run((d, s, ids) => alignElements(d.doc, s.id, ids, mode, to)),
      group: () =>
        run((d, s, ids) => {
          const id = groupElements(d.doc, s.id, ids);
          if (id) setEdit((e) => ({ ...e, selection: [id] }));
        }),
      ungroup: () =>
        run((d, s, ids) => {
          const children = ungroupElements(d.doc, s.id, ids);
          if (children.length) setEdit((e) => ({ ...e, selection: children }));
        }),
      lock: (locked) => run((d, s, ids) => setLocked(d.doc, s.id, ids, locked)),
      replaceImage: (id) => latest.current.external?.pickReplace?.(id),
      crop: (id) => setEdit((e) => ({ ...e, selection: [id], editingId: null, cropId: id })),
      resetSize: (id) => {
        const { slide: s } = latest.current;
        const el = s?.elements.find((e) => e.id === id);
        if (!s || !el?.src) return;
        void naturalSize(el.src).then((natural) => {
          const placed = placementsOf(latest.current.deck!.doc, s.id, [id]).get(id);
          if (!placed || !natural) return;
          run((d, sl) => setPlacements(d.doc, sl.id, { [id]: { ...resetToNatural(placed, natural), crop: null } }));
        });
      },
      addLink: (id) => {
        setEdit((e) => ({ ...e, selection: [id], editingId: id, cropId: null }));
        requestAnimationFrame(() => requestAnimationFrame(() => formatWholeText(id, "link")));
      },
      toggleBuild: (id) =>
        run((d, s) => {
          const el = s.elements.find((e) => e.id === id);
          setBuild(d.doc, s.id, id, el?.build ? null : buildSteps(s) + 1);
        }),
      comment: (id) => {
        const { slide: s, external: ext } = latest.current;
        if (s) ext?.comment?.({ slideId: s.id, elementId: id });
      },
      snapBack: (id) => run((d, s) => snapBack(d.doc, s.id, [id])),
    }),
    [copySelection, pasteClipboard, run],
  );

  const stageHandlers = useCallback(
    (at: Point): StageHandlers => ({
      paste: () => void pasteClipboard(at),
      insert: (item) => latest.current.external?.insertAt?.(item, at),
      changeLayout: (id) => latest.current.external?.changeLayout?.(id),
      selectAll: () => {
        const s = latest.current.slide;
        if (s) setEdit((e) => ({ ...e, selection: [...new Set(s.elements.filter((x) => x.kind !== "group").map((x) => selectionTarget(s, x.id)))] }));
      },
      comment: () => {
        const s = latest.current.slide;
        if (s) latest.current.external?.comment?.({ slideId: s.id, x: at.x / STAGE_W, y: at.y / STAGE_H });
      },
      setGuides: (on) => onPrefs({ items: on, margins: on }),
      setGrid: (on) => onPrefs({ grid: on }),
    }),
    [onPlace, pasteClipboard, onPrefs],
  );

  const barHandlers = useMemo<FormatBarHandlers>(
    () => ({
      textStyle: (id, style) => run((d, s) => setFreeTextStyle(d.doc, s.id, id, style)),
      format: (id, format) => {
        formatWholeText(id, format);
        if (format === "link") setEdit((e) => ({ ...e, selection: [id], editingId: id }));
      },
      fill: (fill) => run((d, s, ids) => setFill(d.doc, s.id, ids, fill)),
      replaceImage: (id) => latest.current.external?.pickReplace?.(id),
      crop: (id) => setEdit((e) => ({ ...e, selection: [id], editingId: null, cropId: id })),
      resetCrop: (id) => run((d, s) => setCrop(d.doc, s.id, id, null)),
      doneCrop: () => setEdit((e) => ({ ...e, cropId: null })),
      unlock: () => run((d, s, ids) => setLocked(d.doc, s.id, ids, false)),
    }),
    [run],
  );

  const insert = useMemo<ContentInsert>(() => {
    const place = (make: (d: DeckDoc, slideId: string) => string | null, edit = false) => {
      const { deck: d, slide: s } = latest.current;
      if (!d || !s) return null;
      const id = d.undo.step(() => make(d, s.id));
      if (id) {
        setEdit((e) => ({ ...e, selection: [id], editingId: edit ? id : null, cropId: null }));
      }
      return id;
    };
    return {
      text: (at) => onPlace({ type: "text" }, at),
      shape: (shape, at) => onPlace({ type: "shape", shape }, at),
      table: (at) => place((d, sid) => addTable(d.doc, sid, at), true),
      code: (at) => place((d, sid) => addCodeBlock(d.doc, sid, at), true),
      chart: (type, at) => place((d, sid) => addChart(d.doc, sid, type, at)),
      icon: (name, at) => place((d, sid) => addIcon(d.doc, sid, name, at)),
      emoji: (emoji, at) => place((d, sid) => addEmoji(d.doc, sid, emoji, at)),
      video: (url, at) => place((d, sid) => addVideo(d.doc, sid, url, at)),
    };
  }, [onPlace]);

  const inspector = useMemo<InspectorFreeform>(
    () => ({
      onPlace: (id, placed) => run((d, s) => setPlacements(d.doc, s.id, { [id]: placed })),
      onAlign: handlers.align,
      onDistribute: (axis) => run((d, s, ids) => distributeElements(d.doc, s.id, ids, axis)),
      onGroup: handlers.group,
      onUngroup: handlers.ungroup,
      onDuplicate: handlers.duplicate,
      onDelete: handlers.remove,
      onReorder: handlers.reorder,
      onSnapBack: handlers.snapBack,
      onFill: (fill) => run((d, s, ids) => setFill(d.doc, s.id, ids, fill)),
      onChart: (id: string, chart: ChartSpec) => run((d, s) => setChart(d.doc, s.id, id, chart)),
      onIcon: (id: string, name: string) => run((d, s) => setIconName(d.doc, s.id, id, name)),
      onVideo: (id: string, url: string) => {
        let ok = false;
        run((d, s) => void (ok = setVideoUrl(d.doc, s.id, id, url)));
        return ok;
      },
      onLock: handlers.lock,
      onDeselect: () => setEdit(EMPTY),
      prefs,
      onPrefs,
    }),
    [run, prefs, onPrefs, handlers],
  );

  useEffect(() => {
    if (!editable) return;
    const onKey = (e: KeyboardEvent) => {
      if (inEditable(e.target)) return;
      const { slide: s, selection: ids } = latest.current;
      if (!s) return;
      const mod = e.metaKey || e.ctrlKey;
      if (e.key === "Escape") {
        setArmed(null);
        dispatch({ type: "escape" });
        return;
      }
      if (e.key === "Enter" && !mod && ids.length === 1) {
        e.preventDefault();
        dispatch({ type: "enter" });
        return;
      }
      if (mod && e.altKey && !e.shiftKey && ids.length > 0) {
        if (e.code === "KeyC") (e.preventDefault(), handlers.copyStyle());
        else if (e.code === "KeyV") (e.preventDefault(), handlers.pasteStyle());
        return;
      }
      if (mod && !e.altKey) {
        const k = e.key.toLowerCase();
        if (k === "a") {
          e.preventDefault();
          stageHandlers({ x: 0, y: 0 }).selectAll();
        } else if (ids.length === 0) return;
        else if (k === "d") (e.preventDefault(), handlers.duplicate());
        else if (k === "g") (e.preventDefault(), e.shiftKey ? handlers.ungroup() : handlers.group());
        else if (e.key === "]") (e.preventDefault(), handlers.reorder(e.shiftKey ? "front" : "forward"));
        else if (e.key === "[") (e.preventDefault(), handlers.reorder(e.shiftKey ? "back" : "backward"));
        return;
      }
      if (ids.length === 0) return;
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        handlers.remove();
        return;
      }
      const nudge = nudgeDelta(e.key, e.shiftKey);
      if (nudge) {
        e.preventDefault();
        const { deck: d } = latest.current;
        if (d) moveElements(d.doc, s.id, ids, nudge.dx, nudge.dy);
      }
    };
    const onCopy = (e: ClipboardEvent, cut: boolean) => {
      if (inEditable(e.target)) return;
      const { slide: s, selection: ids } = latest.current;
      if (!s || ids.length === 0) return;
      const text = serializeSelection(s, ids);
      if (!text) return;
      e.preventDefault();
      clipMemory = text;
      e.clipboardData?.setData("text/plain", text);
      if (cut) handlers.remove();
    };
    const onPaste = (e: ClipboardEvent) => {
      if (inEditable(e.target)) return;
      const files = imageFilesOf(e.clipboardData);
      if (files.length > 0 && latest.current.external?.addImages) {
        e.preventDefault();
        latest.current.external.addImages(files, null);
        return;
      }
      const text = e.clipboardData?.getData("text/plain") ?? "";
      const items = parseClipboard(text);
      if (!items) return;
      e.preventDefault();
      clipMemory = text;
      run((d, s) => {
        const next = pasteItems(d.doc, s.id, items);
        if (next.length) setEdit((st) => ({ ...st, selection: next }));
      });
    };
    const copy = (e: ClipboardEvent) => onCopy(e, false);
    const cut = (e: ClipboardEvent) => onCopy(e, true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("copy", copy);
    window.addEventListener("cut", cut);
    window.addEventListener("paste", onPaste);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("copy", copy);
      window.removeEventListener("cut", cut);
      window.removeEventListener("paste", onPaste);
    };
  }, [editable, handlers, stageHandlers, dispatch, run]);

  const stage = useMemo<StageFreeform>(
    () => ({
      selection: live,
      onSelect: setSelection,
      editingId: edit.editingId,
      onEdit: setEditing,
      cropId: edit.cropId,
      prefs,
      armed,
      onPlace,
      onCommit,
      peerDrags: drags.peers,
      onPublishDrag: drags.publish,
      onActivate: (id, point) => {
        editPoint.current = point;
        dispatch({ type: "dblclick", id });
      },
      editPoint,
      onEscape: () => {
        (document.activeElement as HTMLElement | null)?.blur?.();
        dispatch({ type: "escape" });
      },
      onGrow: (id, needed) => {
        const { deck: d, slide: s } = latest.current;
        if (d && s) setAutoHeight(d.doc, s.id, id, needed);
      },
      onContext: (target) => {
        const sel = target ? contextSelection(latest.current.selection, target) : [];
        setEdit((e) => ({ ...e, selection: sel, editingId: null }));
        return sel;
      },
      handlers,
      stageHandlers,
      barHandlers,
      canPaste: canReadClip(),
      styleKind,
      onDropFiles: (files, at) => latest.current.external?.addImages?.(files, at),
    }),
    [live, setSelection, edit.editingId, edit.cropId, setEditing, prefs, armed, onPlace, onCommit, drags.peers, drags.publish, dispatch, handlers, stageHandlers, barHandlers, styleKind],
  );

  return { selection: live, setSelection, stage, inspector, armed, arm: setArmed, insert };
}
