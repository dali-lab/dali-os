import { useEffect, useMemo, useRef, useState, type Ref } from "react";
import { createPortal } from "react-dom";
import { Check, Undo2 } from "lucide-react";
import { buttonClasses } from "~/components/ui/Button";
import { cn } from "~/lib/cn";
import { classifyEnhanceMark, firstLineOf, priorBlockFirstLine } from "./enhance-plan";
import { animate, DUR, enterRef } from "./motion";
import { deriveRailState } from "./RecordingRail";
import { useEnhancingWash } from "./use-enhancing-wash";
import { useMarkTransitions } from "./use-mark-transitions";
import { contentOf, findBlock } from "./block-dom";
import type { UseMeetingRecording } from "./use-meeting-recording";

type BlockBox = { top: number; bottom: number; left: number; right: number };

export const WAS_ATTR = "data-enhance-was";
const PILL_IN = enterRef(
  [
    { opacity: 0, transform: "scale(.94)" },
    { opacity: 1, transform: "scale(1)" },
  ],
  DUR.pill,
);
const WAS_IN = enterRef([{ opacity: 0 }, { opacity: 1 }], DUR.wasIn, { delay: DUR.wasInDelay });

type WasLine = { box: BlockBox; prior: string };

function GhostWasLine({ id, line, onDone }: { id: string; line: WasLine; onDone: () => void }) {
  const ref = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    const handle = animate(ref.current, [{ opacity: 1 }, { opacity: 0 }], DUR.wasOut, { fill: "forwards" });
    void handle.then(onDone);
    return () => handle.cancel();
  }, []);
  return <WasText ref={ref} id={id} line={line} />;
}

function WasText({ id, line, ref }: { id: string; line: WasLine; ref?: Ref<HTMLParagraphElement> }) {
  const { box, prior } = line;
  return (
    <p
      ref={ref}
      data-was-for={id}
      style={{ position: "fixed", top: box.bottom - 24, left: box.left + 24, maxWidth: Math.max(0, box.right - box.left - 40) }}
      className="pointer-events-none z-10 truncate text-[13px] leading-5 text-muted-foreground"
    >
      You wrote: “{prior}”
    </p>
  );
}
const ACTIONS_ATTR = "data-enhance-actions";

function pendingBlockAt(node: Node | null, root: HTMLElement, ids: ReadonlySet<string>): string | null {
  let el: Element | null = node instanceof Element ? node : (node?.parentElement ?? null);
  while (el && el !== root) {
    const id = el.getAttribute("data-id");
    if (id && ids.has(id)) return id;
    el = el.parentElement;
  }
  return null;
}

function sameBox(a: BlockBox | undefined, b: BlockBox): boolean {
  return Boolean(a) && a!.top === b.top && a!.bottom === b.bottom && a!.left === b.left && a!.right === b.right;
}

/**
 * Keep / Revert on the hovered or caret block, and the "You wrote" line under
 * a changed block. React overlays positioned over the editor's blocks: nothing
 * here writes into the document except through rec.keepBlock / rec.revertBlock.
 */
export function EnhanceBlockActions({
  rec,
  getRoot,
}: {
  rec: UseMeetingRecording;
  getRoot: () => HTMLElement | null;
}) {
  const [root, setRoot] = useState<HTMLElement | null>(null);
  const [boxes, setBoxes] = useState<Record<string, BlockBox>>({});
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [caretId, setCaretId] = useState<string | null>(null);

  const priorBlocks = rec.enhanceNotes?.priorBlocks;
  const marks = rec.pendingMarks;
  const idKey = marks.map((m) => `${m.id}:${m.mark}`).join("|");
  const ids = useMemo(() => new Set(marks.map((m) => m.id)), [idKey]);
  const changedIds = useMemo(
    () => marks.filter((m) => classifyEnhanceMark(m, priorBlocks) === "Changed").map((m) => m.id),
    [idKey, priorBlocks],
  );

  const [leaving, setLeaving] = useState<Record<string, WasLine>>({});
  const lastWas = useRef<Record<string, WasLine>>({});
  const wasLines: Record<string, WasLine> = {};
  for (const id of changedIds) {
    const box = boxes[id];
    const prior = priorBlockFirstLine(priorBlocks?.[id]);
    if (box && prior) wasLines[id] = { box, prior };
  }
  const leavingKey = Object.keys(leaving).join("|");

  useMarkTransitions({ marks, priorBlocks, getRoot });
  useEnhancingWash({
    active: deriveRailState(rec) === "generating",
    getRoot,
    getBlocks: () => rec.getNoteState?.()?.blocks ?? [],
  });

  useEffect(() => {
    const next = marks.length > 0 ? getRoot() : null;
    if (next !== root) setRoot(next);
  });

  useEffect(() => {
    const before = lastWas.current;
    lastWas.current = wasLines;
    const gone = Object.keys(before).filter((id) => !(id in wasLines));
    if (gone.length > 0) setLeaving((prev) => ({ ...prev, ...Object.fromEntries(gone.map((id) => [id, before[id]!])) }));
  });

  useEffect(() => {
    const host = getRoot();
    if (!host || leavingKey === "") return;
    const els = leavingKey.split("|").map((id) => findBlock(host, id)).filter((el): el is HTMLElement => el !== null);
    for (const el of els) el.setAttribute(WAS_ATTR, "");
    return () => {
      for (const el of els) el.removeAttribute(WAS_ATTR);
    };
  }, [leavingKey]);

  useEffect(() => {
    if (!root) {
      setBoxes({});
      return;
    }

    function measure() {
      const next: Record<string, BlockBox> = {};
      for (const id of ids) {
        const block = findBlock(root!, id);
        if (!block) continue;
        if (changedIds.includes(id)) block.setAttribute(WAS_ATTR, "");
        const r = contentOf(block).getBoundingClientRect();
        next[id] = { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
      }
      setBoxes((prev) => {
        const keys = Object.keys(next);
        if (keys.length === Object.keys(prev).length && keys.every((k) => sameBox(prev[k], next[k]!))) return prev;
        return next;
      });
    }

    measure();
    const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    resize?.observe(root);
    const mutation = new MutationObserver(measure);
    mutation.observe(root, { childList: true, subtree: true, characterData: true });
    window.addEventListener("scroll", measure, true);
    window.addEventListener("resize", measure);

    function onOver(e: MouseEvent) {
      setHoverId(pendingBlockAt(e.target as Node, root!, ids));
    }
    function onOut(e: MouseEvent) {
      const to = e.relatedTarget as Element | null;
      if (to?.closest?.(`[${ACTIONS_ATTR}]`)) return;
      setHoverId(null);
    }
    function onSelection() {
      const anchor = document.getSelection()?.anchorNode ?? null;
      setCaretId(anchor && root!.contains(anchor) ? pendingBlockAt(anchor, root!, ids) : null);
    }
    root.addEventListener("mouseover", onOver);
    root.addEventListener("mouseout", onOut);
    document.addEventListener("selectionchange", onSelection);

    return () => {
      resize?.disconnect();
      mutation.disconnect();
      window.removeEventListener("scroll", measure, true);
      window.removeEventListener("resize", measure);
      root.removeEventListener("mouseover", onOver);
      root.removeEventListener("mouseout", onOut);
      document.removeEventListener("selectionchange", onSelection);
      for (const el of root.querySelectorAll(`[${WAS_ATTR}]`)) el.removeAttribute(WAS_ATTR);
    };
  }, [root, ids, changedIds]);

  if ((!root || marks.length === 0) && leavingKey === "") return null;

  const activeId = hoverId ?? caretId;
  const active = activeId ? marks.find((m) => m.id === activeId) : undefined;
  const activeBox = activeId ? boxes[activeId] : undefined;
  const label = active ? firstLineOf(active.text) || "this block" : "";

  return createPortal(
    <>
      {Object.entries(wasLines).map(([id, line]) => (
        <WasText key={id} id={id} line={line} ref={WAS_IN} />
      ))}
      {Object.entries(leaving)
        .filter(([id]) => !(id in wasLines))
        .map(([id, line]) => (
          <GhostWasLine
            key={id}
            id={id}
            line={line}
            onDone={() =>
              setLeaving((prev) => {
                const { [id]: _done, ...rest } = prev;
                return rest;
              })
            }
          />
        ))}
      {rec.canEdit && active && activeBox && (
        <div
          key={active.id}
          ref={PILL_IN}
          {...{ [ACTIONS_ATTR]: active.id }}
          role="group"
          aria-label="Review this change"
          onMouseEnter={() => setHoverId(active.id)}
          onMouseLeave={() => setHoverId(null)}
          style={{ position: "fixed", top: activeBox.top + 2, right: window.innerWidth - activeBox.right + 8 }}
          className={cn("z-30 flex gap-0.5 rounded-full border border-border bg-card p-0.5 shadow-sm")}
        >
          <button
            type="button"
            aria-label={`Keep change: ${label}`}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => rec.keepBlock(active.id)}
            className={buttonClasses("ghost", "xs", "gap-1 text-xs font-bold")}
          >
            <Check className="h-3 w-3 text-os-accent" aria-hidden /> Keep
          </button>
          <button
            type="button"
            aria-label={`Revert change: ${label}`}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => rec.revertBlock(active.id)}
            className={buttonClasses("ghost", "xs", "gap-1 text-xs font-bold")}
          >
            <Undo2 className="h-3 w-3" aria-hidden /> Revert
          </button>
        </div>
      )}
    </>,
    document.body,
  );
}
