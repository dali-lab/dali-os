import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { parseClipboard, serializeSelection } from "~/components/slides/deck/clipboard";
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
  deleteElements,
  distributeElements,
  duplicateElements,
  groupElements,
  moveElements,
  pasteItems,
  reorderElements,
  setChart,
  setFill,
  setIconName,
  setPlacements,
  setVideoUrl,
  snapBack,
  ungroupElements,
} from "~/components/slides/deck/freeform-ops";
import { selectionTarget, type Placed } from "~/components/slides/deck/freeform";
import { nudgeDelta } from "~/components/slides/deck/geometry";
import type { ChartSpec, ChartType } from "~/components/slides/deck/content";
import type { RenderSlide } from "~/components/slides/deck/snapshot";
import type { ArmedTool } from "./FreeformLayer";
import type { InspectorFreeform } from "./ElementInspector";
import { useSnapPrefs } from "./snap-prefs";
import type { StageFreeform } from "./SlideStage";
import { useSlideDrags, type DeckDoc } from "./useDeckDoc";

const inEditable = (target: EventTarget | null) => Boolean((target as HTMLElement | null)?.closest?.("[contenteditable='true'], input, textarea, select"));

type At = { x: number; y: number };

/** Each puts one element on the current slide as one undo step, selects it, and returns its id. */
export interface ContentInsert {
  table: (at?: At) => string | null;
  code: (at?: At) => string | null;
  chart: (type: ChartType, at?: At) => string | null;
  icon: (name: string, at?: At) => string | null;
  emoji: (emoji: string, at?: At) => string | null;
  video: (url: string, at?: At) => string | null;
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

/** Selection, the armed insert tool, and every freeform edit for the slide on screen. Each gesture is one undo step. */
export function useFreeformEditor({
  deck,
  slide,
  editable,
}: {
  deck: DeckDoc | null;
  slide: RenderSlide | null;
  editable: boolean;
}): FreeformEditor {
  const [selection, setSelectionState] = useState<string[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [armed, setArmed] = useState<ArmedTool | null>(null);
  const [prefs, onPrefs] = useSnapPrefs();
  const drags = useSlideDrags(deck, editable && slide ? slide.id : null);
  const slideId = slide?.id ?? null;

  useEffect(() => {
    setSelectionState([]);
    setEditingId(null);
    setArmed(null);
  }, [slideId]);

  const present = useMemo(() => new Set(slide?.elements.map((e) => e.id) ?? []), [slide]);
  const known = useRef<{ slideId: string | null; ids: Set<string> }>({ slideId: null, ids: new Set() });
  if (known.current.slideId !== slideId) known.current = { slideId, ids: new Set() };
  const seen = known.current.ids;
  const live = useMemo(() => selection.filter((id) => present.has(id) || !seen.has(id)), [selection, present, seen]);
  useEffect(() => {
    present.forEach((id) => seen.add(id));
  }, [present, seen]);
  useEffect(() => {
    if (live.length !== selection.length) setSelectionState(live);
  }, [live, selection.length]);

  const latest = useRef({ deck, slide, selection: live });
  latest.current = { deck, slide, selection: live };

  const run = useCallback((fn: (deck: DeckDoc, slide: RenderSlide, ids: string[]) => void) => {
    const { deck: d, slide: s, selection: ids } = latest.current;
    if (!d || !s) return;
    d.undo.step(() => fn(d, s, ids));
  }, []);

  const setSelection = useCallback((ids: string[]) => setSelectionState(ids), []);

  const onCommit = useCallback((updates: Record<string, Placed>) => run((d, s) => setPlacements(d.doc, s.id, updates)), [run]);

  const onPlace = useCallback(
    (tool: ArmedTool, at: { x: number; y: number }) => {
      const { deck: d, slide: s } = latest.current;
      if (!d || !s) return;
      const id = d.undo.step(() => (tool.type === "text" ? addTextBox(d.doc, s.id, at) : addShape(d.doc, s.id, tool.shape, at)));
      setArmed(null);
      if (id) {
        setSelectionState([id]);
        if (tool.type === "text") setEditingId(id);
      }
    },
    [],
  );

  const insert = useMemo<ContentInsert>(() => {
    const place = (make: (d: DeckDoc, slideId: string) => string | null, edit = false) => {
      const { deck: d, slide: s } = latest.current;
      if (!d || !s) return null;
      const id = d.undo.step(() => make(d, s.id));
      if (id) {
        setSelectionState([id]);
        if (edit) setEditingId(id);
      }
      return id;
    };
    return {
      table: (at) => place((d, sid) => addTable(d.doc, sid, at), true),
      code: (at) => place((d, sid) => addCodeBlock(d.doc, sid, at), true),
      chart: (type, at) => place((d, sid) => addChart(d.doc, sid, type, at)),
      icon: (name, at) => place((d, sid) => addIcon(d.doc, sid, name, at)),
      emoji: (emoji, at) => place((d, sid) => addEmoji(d.doc, sid, emoji, at)),
      video: (url, at) => place((d, sid) => addVideo(d.doc, sid, url, at)),
    };
  }, []);

  const inspector = useMemo<InspectorFreeform>(
    () => ({
      onPlace: (id, placed) => run((d, s) => setPlacements(d.doc, s.id, { [id]: placed })),
      onAlign: (mode, to) => run((d, s, ids) => alignElements(d.doc, s.id, ids, mode, to)),
      onDistribute: (axis) => run((d, s, ids) => distributeElements(d.doc, s.id, ids, axis)),
      onGroup: () =>
        run((d, s, ids) => {
          const id = groupElements(d.doc, s.id, ids);
          if (id) setSelectionState([id]);
        }),
      onUngroup: () =>
        run((d, s, ids) => {
          const children = ungroupElements(d.doc, s.id, ids);
          if (children.length) setSelectionState(children);
        }),
      onDuplicate: () =>
        run((d, s, ids) => {
          const next = duplicateElements(d.doc, s.id, ids);
          if (next.length) setSelectionState(next);
        }),
      onDelete: () =>
        run((d, s, ids) => {
          deleteElements(d.doc, s.id, ids);
        }),
      onReorder: (dir) => run((d, s, ids) => reorderElements(d.doc, s.id, ids, dir)),
      onSnapBack: (id) => run((d, s) => snapBack(d.doc, s.id, [id])),
      onFill: (fill) => run((d, s, ids) => setFill(d.doc, s.id, ids, fill)),
      onChart: (id: string, chart: ChartSpec) => run((d, s) => setChart(d.doc, s.id, id, chart)),
      onIcon: (id: string, name: string) => run((d, s) => setIconName(d.doc, s.id, id, name)),
      onVideo: (id: string, url: string) => {
        let ok = false;
        run((d, s) => void (ok = setVideoUrl(d.doc, s.id, id, url)));
        return ok;
      },
      onDeselect: () => setSelectionState([]),
      prefs,
      onPrefs,
    }),
    [run, prefs, onPrefs],
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
        setEditingId(null);
        setSelectionState([]);
        return;
      }
      if (mod && !e.altKey) {
        const k = e.key.toLowerCase();
        if (k === "a") {
          e.preventDefault();
          setSelectionState([...new Set(s.elements.filter((x) => x.kind !== "group").map((x) => selectionTarget(s, x.id)))]);
        } else if (ids.length === 0) return;
        else if (k === "d") (e.preventDefault(), inspector.onDuplicate());
        else if (k === "g") (e.preventDefault(), e.shiftKey ? inspector.onUngroup() : inspector.onGroup());
        else if (e.key === "]") (e.preventDefault(), inspector.onReorder(e.shiftKey ? "front" : "forward"));
        else if (e.key === "[") (e.preventDefault(), inspector.onReorder(e.shiftKey ? "back" : "backward"));
        return;
      }
      if (ids.length === 0) return;
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        inspector.onDelete();
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
      e.clipboardData?.setData("text/plain", text);
      if (cut) inspector.onDelete();
    };
    const onPaste = (e: ClipboardEvent) => {
      if (inEditable(e.target)) return;
      const text = e.clipboardData?.getData("text/plain") ?? "";
      const items = parseClipboard(text);
      if (!items) return;
      e.preventDefault();
      run((d, s) => {
        const next = pasteItems(d.doc, s.id, items);
        if (next.length) setSelectionState(next);
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
  }, [editable, inspector, run]);

  const stage = useMemo<StageFreeform>(
    () => ({
      selection: live,
      onSelect: setSelection,
      editingId,
      onEdit: setEditingId,
      prefs,
      armed,
      onPlace,
      onCommit,
      peerDrags: drags.peers,
      onPublishDrag: drags.publish,
    }),
    [live, setSelection, editingId, prefs, armed, onPlace, onCommit, drags.peers, drags.publish],
  );

  return { selection: live, setSelection, stage, inspector, armed, arm: setArmed, insert };
}
