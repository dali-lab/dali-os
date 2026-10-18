import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router";
import { ListChecks } from "lucide-react";
import { Avatar } from "~/components/ui/Avatar";
import { Checkbox } from "~/components/ui/Checkbox";
import { DateField } from "~/components/ui/DateField";
import { Combobox, type SelectOption } from "~/components/ui/floating";
import { cn } from "~/lib/cn";
import { useActionItemDraft } from "./action-item-draft";
import { actionItemMatchesBlock } from "./enhance-plan";
import { isSearchableQuery, useLabMemberSearch } from "./member-search";
import { formatIsoDate, type UseMeetingRecording } from "./use-meeting-recording";

export const CHIPS_ATTR = "data-action-chips";
export const NARROW_BREAKPOINT = 700;

const CHIP_BASE = "h-7 rounded-full border px-2.5 text-xs font-medium";
const CHIP_CLASS = cn(CHIP_BASE, "border-border bg-card text-foreground");
const UNMATCHED_CLASS = cn(CHIP_BASE, "border-dashed border-os-amber/60 bg-os-amber/10 text-foreground");

type Placement = { index: number; box: { top: number; bottom: number; left: number; right: number } };

function findBlock(root: HTMLElement, id: string): HTMLElement | null {
  for (const el of root.querySelectorAll<HTMLElement>("[data-id]")) {
    if (el.getAttribute("data-id") === id) return el;
  }
  return null;
}

function contentOf(block: HTMLElement): HTMLElement {
  return block.querySelector<HTMLElement>(":scope > .bn-block > .bn-block-content") ?? block;
}

function samePlacements(a: Placement[], b: Placement[]): boolean {
  return (
    a.length === b.length &&
    a.every((p, i) => {
      const q = b[i]!;
      return p.index === q.index && p.box.top === q.box.top && p.box.bottom === q.box.bottom && p.box.left === q.box.left && p.box.right === q.box.right;
    })
  );
}

function OwnerChip({ index }: { index: number }) {
  const draft = useActionItemDraft()!;
  const row = draft.rowFor(index);
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
  return (
    <>
      {item.ownerName && <span className={cn(CHIP_CLASS, "inline-flex items-center")}>{item.ownerName}</span>}
      {item.due && <span className={cn(CHIP_CLASS, "inline-flex items-center")}>{formatIsoDate(item.due)}</span>}
    </>
  );
}

function ItemChips({ index }: { index: number }) {
  const draft = useActionItemDraft()!;
  const item = draft.items[index]!;
  const row = draft.rowFor(index);

  if (item.taskId) {
    return draft.projectId ? (
      <Link
        to={`/projects/${draft.projectId}?tab=progress&task=${item.taskId}`}
        className={cn(CHIP_BASE, "inline-flex items-center gap-1 border-os-accent/40 bg-os-accent/10 text-os-accent")}
      >
        <ListChecks className="h-3.5 w-3.5" aria-hidden />
        Task
      </Link>
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
          <OwnerChip index={index} />
          <DueChip index={index} />
        </>
      ) : (
        <span className="text-xs text-muted-foreground">No task</span>
      )}
    </div>
  );
}

/**
 * Owner and due chips at the right edge of each checklist block that matches
 * one of the plan's action items. A React overlay driven by the plan: nothing
 * here writes into the document.
 */
export function ActionItemChips({ rec, getRoot }: { rec: UseMeetingRecording; getRoot: () => HTMLElement | null }) {
  const draft = useActionItemDraft();
  const [root, setRoot] = useState<HTMLElement | null>(null);
  const [placements, setPlacements] = useState<Placement[]>([]);
  const [narrow, setNarrow] = useState(false);
  const recRef = useRef(rec);
  recRef.current = rec;

  const active = Boolean(draft && draft.items.length > 0 && rec.enhanceNotes && rec.pendingMarks.length === 0);
  const itemsKey = draft?.items.map((it) => `${it.text}|${it.taskId ?? ""}`).join("\n") ?? "";

  useEffect(() => {
    const next = active ? getRoot() : null;
    if (next !== root) setRoot(next);
  });

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
      for (let index = 0; index < items.length; index++) {
        const block = blocks.find((b) => !used.has(b.id) && actionItemMatchesBlock(items[index]!.text, b.text));
        if (!block) continue;
        const el = findBlock(root!, block.id);
        if (!el) continue;
        used.add(block.id);
        const content = contentOf(el);
        content.setAttribute(CHIPS_ATTR, "");
        const r = content.getBoundingClientRect();
        next.push({ index, box: { top: r.top, bottom: r.bottom, left: r.left, right: r.right } });
      }
      setPlacements((prev) => (samePlacements(prev, next) ? prev : next));
      setNarrow(window.innerWidth < NARROW_BREAKPOINT);
    }

    measure();
    const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    resize?.observe(root);
    const mutation = new MutationObserver(measure);
    mutation.observe(root, { childList: true, subtree: true, characterData: true });
    window.addEventListener("scroll", measure, true);
    window.addEventListener("resize", measure);
    return () => {
      resize?.disconnect();
      mutation.disconnect();
      window.removeEventListener("scroll", measure, true);
      window.removeEventListener("resize", measure);
      for (const el of root.querySelectorAll(`[${CHIPS_ATTR}]`)) el.removeAttribute(CHIPS_ATTR);
    };
  }, [root, itemsKey]);

  if (!draft || !root || placements.length === 0) return null;

  return createPortal(
    <>
      {placements.map(({ index, box }) => (
        <div
          key={index}
          data-action-chips-for={index}
          style={
            narrow
              ? { position: "fixed", top: box.bottom - 32, left: box.left + 28 }
              : { position: "fixed", top: box.top + 1, right: window.innerWidth - box.right + 8 }
          }
          className="z-20 flex flex-wrap items-center gap-1.5"
        >
          <ItemChips index={index} />
        </div>
      ))}
    </>,
    document.body,
  );
}
