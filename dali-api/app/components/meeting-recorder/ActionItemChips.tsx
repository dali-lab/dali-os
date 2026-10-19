import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router";
import { ListChecks } from "lucide-react";
import { Avatar } from "~/components/ui/Avatar";
import { Checkbox } from "~/components/ui/Checkbox";
import { DateField } from "~/components/ui/DateField";
import { Combobox, Tooltip, type SelectOption } from "~/components/ui/floating";
import { cn } from "~/lib/cn";
import { useActionItemDraft } from "./action-item-draft";
import { actionItemMatchesBlock } from "./enhance-plan";
import { contentOf, findBlock, frameThrottle, inBounds, overlayBounds } from "./block-dom";
import { useBlockStyleRules } from "./block-style-rules";
import { chipSpaceCss, NARROW_BREAKPOINT } from "./enhance-rules";
import { DUR, POP_FRAMES, animate } from "./motion";
import { PopIn } from "./PopIn";
import { isSearchableQuery, useLabMemberSearch } from "./member-search";
import { formatIsoDate, type UseMeetingRecording } from "./use-meeting-recording";

export { NARROW_BREAKPOINT };

const CHIP_BASE = "h-7 rounded-full border px-2.5 text-xs font-medium";
const CHIP_CLASS = cn(CHIP_BASE, "border-border bg-card text-foreground");
const UNMATCHED_CLASS = cn(CHIP_BASE, "border-dashed border-os-amber/60 bg-os-amber/10 text-foreground");

type Placement = { index: number; id: string; visible: boolean; box: { top: number; bottom: number; left: number; right: number } };
type Size = { width: number; height: number };

function samePlacements(a: Placement[], b: Placement[]): boolean {
  return (
    a.length === b.length &&
    a.every((p, i) => {
      const q = b[i]!;
      return p.index === q.index && p.id === q.id && p.visible === q.visible && p.box.top === q.box.top && p.box.bottom === q.box.bottom && p.box.left === q.box.left && p.box.right === q.box.right;
    })
  );
}

function OwnerChip({ index }: { index: number }) {
  const draft = useActionItemDraft()!;
  const row = draft.rowFor(index);
  const swap = useRef<HTMLDivElement>(null);
  const lastOwner = useRef(row.ownerUserId);
  useEffect(() => {
    if (lastOwner.current === row.ownerUserId) return;
    lastOwner.current = row.ownerUserId;
    void animate(swap.current, POP_FRAMES(0.92), DUR.ownerIn);
  }, [row.ownerUserId]);
  const item = draft.items[index]!;
  const { setQuery, query, results } = useLabMemberSearch();

  const options = useMemo<SelectOption[]>(() => {
    const roster: SelectOption[] = draft.roster.map((r) => ({ value: r.userId, label: r.name, description: "In this meeting" }));
    const found: SelectOption[] = results
      .filter((m) => !draft.roster.some((r) => r.userId === m.id))
      .map((m) => ({ value: m.id, label: m.name, description: "Lab member" }));
    const known = [...roster, ...found];
    if (row.ownerUserId && !known.some((o) => o.value === row.ownerUserId)) {
      known.push({ value: row.ownerUserId, label: row.ownerName || "Assigned" });
    }
    return known;
  }, [draft.roster, results, row.ownerUserId, row.ownerName]);

  const unmatched = !row.ownerUserId && Boolean(item.ownerName);
  const selectedName = options.find((o) => o.value === row.ownerUserId)?.label;

  return (
    <div ref={swap}>
    <Combobox
      value={row.ownerUserId}
      options={options}
      onChange={(value) => draft.setRow(index, { ownerUserId: value, ownerName: options.find((o) => o.value === value)?.label ?? "" })}
      onQueryChange={setQuery}
      ariaLabel={`Owner for ${item.text}`}
      placeholder={unmatched ? `“${item.ownerName}” · pick owner` : "Add owner"}
      emptyLabel={isSearchableQuery(query) ? "No matches" : "Type to search lab members"}
      icon={selectedName ? <Avatar name={selectedName} size="xs" /> : undefined}
      className={cn("w-48", unmatched ? UNMATCHED_CLASS : CHIP_CLASS)}
    />
    </div>
  );
}

function DueChip({ index }: { index: number }) {
  const draft = useActionItemDraft()!;
  const row = draft.rowFor(index);
  return (
    <div className="w-36">
      <DateField
        mode="date"
        value={row.dueAt}
        onChange={(value) => draft.setRow(index, { dueAt: value })}
        placeholder="Add date"
        ariaLabel={`Due date for ${draft.items[index]!.text}`}
        buttonClassName={cn(CHIP_CLASS, "justify-between")}
      />
    </div>
  );
}

function ReadOnlyChips({ index }: { index: number }) {
  const draft = useActionItemDraft()!;
  const item = draft.items[index]!;
  if (!item.ownerName && !item.due) return null;
  const unmatched = Boolean(item.ownerName) && !item.ownerUserId;
  return (
    <>
      {item.ownerName &&
        (unmatched ? (
          <Tooltip content={`${item.ownerName}: no match on the roster`}>
            <span tabIndex={0} className={cn(CHIP_CLASS, "inline-flex items-center")}>
              {item.ownerName}
            </span>
          </Tooltip>
        ) : (
          <span className={cn(CHIP_CLASS, "inline-flex items-center")}>{item.ownerName}</span>
        ))}
      {item.due && <span className={cn(CHIP_CLASS, "inline-flex items-center")}>{formatIsoDate(item.due)}</span>}
    </>
  );
}

function ItemChips({ index, order }: { index: number; order: number }) {
  const draft = useActionItemDraft()!;
  const item = draft.items[index]!;
  const row = draft.rowFor(index);

  if (item.taskId) {
    return draft.projectId ? (
      <PopIn from={0.8} ms={DUR.taskChip} delay={order * DUR.taskChipStagger} enabled={draft.created !== null}>
        <Link
          to={`/projects/${draft.projectId}?tab=progress&task=${item.taskId}`}
          className={cn(CHIP_BASE, "inline-flex items-center gap-1 border-os-accent/40 bg-os-accent/10 text-os-accent")}
        >
          <ListChecks className="h-3.5 w-3.5" aria-hidden />
          Task
        </Link>
      </PopIn>
    ) : null;
  }

  if (!draft.editable) return <ReadOnlyChips index={index} />;

  return (
    <div className={cn("flex items-center gap-1.5", !row.checked && "opacity-50")}>
      <Checkbox
        tone="os"
        checked={row.checked}
        onChange={(e) => draft.setRow(index, { checked: e.target.checked })}
        aria-label={`Make a task: ${item.text}`}
      />
      {row.checked ? (
        <>
          <PopIn delay={order * DUR.chipStagger}>
            <OwnerChip index={index} />
          </PopIn>
          <PopIn delay={order * DUR.chipStagger + DUR.chipGap}>
            <DueChip index={index} />
          </PopIn>
        </>
      ) : (
        <span className="text-xs text-muted-foreground">No task</span>
      )}
    </div>
  );
}

function ChipGroup({
  index,
  style,
  onSize,
  children,
}: {
  index: number;
  style: CSSProperties;
  onSize: (index: number, size: Size) => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const report = () => {
      const r = el.getBoundingClientRect();
      onSize(index, { width: r.width, height: r.height });
    };
    report();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(report);
    observer.observe(el);
    return () => observer.disconnect();
  }, [index]);
  return (
    <div ref={ref} data-action-chips-for={index} style={style} className="z-20 flex flex-wrap items-center gap-1.5">
      {children}
    </div>
  );
}

/**
 * Owner and due chips at the right edge of each checklist block that matches
 * one of the plan's action items. A React overlay driven by the plan: nothing
 * here writes into the editor's DOM or the document. The room the chips need
 * is reserved by a generated style rule sized to the rendered chip group.
 */
export function ActionItemChips({ rec, getRoot }: { rec: UseMeetingRecording; getRoot: () => HTMLElement | null }) {
  const draft = useActionItemDraft();
  const [root, setRoot] = useState<HTMLElement | null>(null);
  const [placements, setPlacements] = useState<Placement[]>([]);
  const [narrow, setNarrow] = useState(false);
  const [sizes, setSizes] = useState<Record<number, Size>>({});
  const recRef = useRef(rec);
  recRef.current = rec;

  const active = Boolean(draft && draft.items.length > 0 && rec.enhanceNotes && rec.pendingMarks.length === 0);
  const itemsKey = draft?.items.map((it) => `${it.text}|${it.taskId ?? ""}`).join("\n") ?? "";

  useEffect(() => {
    const next = active ? getRoot() : null;
    if (next !== root) setRoot(next);
  });

  const reportSize = (index: number, size: Size) =>
    setSizes((prev) => {
      const old = prev[index];
      return old && old.width === size.width && old.height === size.height ? prev : { ...prev, [index]: size };
    });

  useBlockStyleRules(
    "chips",
    chipSpaceCss(placements.map((p) => ({ id: p.id, width: sizes[p.index]?.width ?? 0, height: sizes[p.index]?.height ?? 0 }))),
  );

  useEffect(() => {
    if (!root || !draft) {
      setPlacements([]);
      return;
    }
    const items = draft.items;

    function measure() {
      const blocks = (recRef.current.getNoteState?.()?.blocks ?? []).filter((b) => b.type === "checkListItem");
      const used = new Set<string>();
      const next: Placement[] = [];
      const bounds = overlayBounds(root!);
      for (let index = 0; index < items.length; index++) {
        const block = blocks.find((b) => !used.has(b.id) && actionItemMatchesBlock(items[index]!.text, b.text));
        if (!block) continue;
        const el = findBlock(root!, block.id);
        if (!el) continue;
        used.add(block.id);
        const content = contentOf(el);
        resize?.observe(content);
        const r = content.getBoundingClientRect();
        next.push({ index, id: block.id, visible: inBounds(r, bounds), box: { top: r.top, bottom: r.bottom, left: r.left, right: r.right } });
      }
      setPlacements((prev) => (samePlacements(prev, next) ? prev : next));
      setNarrow(window.innerWidth < NARROW_BREAKPOINT);
    }

    const frame = frameThrottle(measure);
    const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(frame.run);
    resize?.observe(root);
    measure();
    const mutation = new MutationObserver(frame.run);
    mutation.observe(root, { childList: true, subtree: true, characterData: true });
    window.addEventListener("scroll", frame.run, true);
    window.addEventListener("resize", frame.run);
    return () => {
      frame.cancel();
      resize?.disconnect();
      mutation.disconnect();
      window.removeEventListener("scroll", frame.run, true);
      window.removeEventListener("resize", frame.run);
    };
  }, [root, itemsKey, rec.noteVersion]);

  if (!draft || !root || placements.length === 0) return null;

  return createPortal(
    <>
      {placements.map(({ index, box, visible }, order) => (
        <ChipGroup
          key={index}
          index={index}
          onSize={reportSize}
          style={{
            ...(narrow
              ? { position: "fixed", top: box.bottom - 32, left: box.left + 28 }
              : { position: "fixed", top: box.top + 1, right: window.innerWidth - box.right + 8 }),
            visibility: visible ? undefined : "hidden",
          }}
        >
          <ItemChips index={index} order={order} />
        </ChipGroup>
      ))}
    </>,
    document.body,
  );
}
