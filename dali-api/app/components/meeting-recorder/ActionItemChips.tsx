import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Plus, X } from "lucide-react";
import { IconButton } from "~/components/ui/IconButton";
import { Combobox, Tooltip, type SelectOption } from "~/components/ui/floating";
import {
  TASK_CHIP_BASE as CHIP_BASE,
  TASK_CHIP_CLASS as CHIP_CLASS,
  TASK_CHIP_REQUIRED_CLASS as UNMATCHED_CLASS,
  TaskDueChip,
  TaskOwnerChip,
  TaskStatusChip,
} from "~/components/tasks/TaskFieldChips";
import { cn } from "~/lib/cn";
import { useActionItemDraft } from "./action-item-draft";
import { findSuggestionLines } from "./enhance-plan";
import { contentOf, findBlock, frameThrottle, overlayHost, toHost, type HostBox } from "./block-dom";
import { useBlockStyleRules } from "./block-style-rules";
import { chipSpaceCss, NARROW_BREAKPOINT } from "./enhance-rules";
import { DUR } from "./motion";
import { PopIn } from "./PopIn";
import { formatIsoDate, type UseMeetingRecording } from "./use-meeting-recording";

export { NARROW_BREAKPOINT };

type Placement = { index: number; id: string; box: HostBox; fromRight: number };
type Size = { width: number; height: number };

function samePlacements(a: Placement[], b: Placement[]): boolean {
  return (
    a.length === b.length &&
    a.every((p, i) => {
      const q = b[i]!;
      return p.index === q.index && p.id === q.id && p.fromRight === q.fromRight && p.box.top === q.box.top && p.box.bottom === q.box.bottom && p.box.left === q.box.left && p.box.right === q.box.right;
    })
  );
}

function OwnerChip({ index }: { index: number }) {
  const draft = useActionItemDraft()!;
  const row = draft.rowFor(index);
  const item = draft.items[index]!;
  const unmatched = !row.ownerUserId && Boolean(item.ownerName);
  return (
    <TaskOwnerChip
      value={row.ownerUserId}
      name={row.ownerName}
      roster={draft.roster}
      rosterLabel="In this meeting"
      onChange={(ownerUserId, ownerName) => draft.setRow(index, { ownerUserId, ownerName })}
      ariaLabel={`Owner for ${item.text}`}
      placeholder={unmatched ? `“${item.ownerName}” · pick owner` : "Add owner"}
      className={cn("w-48", unmatched ? UNMATCHED_CLASS : CHIP_CLASS)}
    />
  );
}

function DueChip({ index }: { index: number }) {
  const draft = useActionItemDraft()!;
  const required = draft.needsDate(index);
  return (
    <TaskDueChip
      value={draft.rowFor(index).dueAt}
      onChange={(dueAt) => draft.setRow(index, { dueAt })}
      ariaLabel={`Due date for ${draft.items[index]!.text}`}
      buttonClassName={cn(required ? UNMATCHED_CLASS : CHIP_CLASS, "justify-between")}
    />
  );
}

function ProjectChip({ index }: { index: number }) {
  const draft = useActionItemDraft()!;
  const projectId = draft.rowFor(index).projectId;
  const options = useMemo<SelectOption[]>(() => draft.projects.map((p) => ({ value: p.id, label: p.name })), [draft.projects]);
  return (
    <Combobox
      value={projectId}
      options={options}
      onChange={(next) => draft.setRow(index, { projectId: next })}
      ariaLabel={`Project for ${draft.items[index]!.text}`}
      placeholder="Pick project"
      className={cn("w-40", projectId ? CHIP_CLASS : UNMATCHED_CLASS)}
    />
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

  if (item.taskId) return null;
  if (!draft.editable) return <ReadOnlyChips index={index} />;

  const delay = (n: number) => order * DUR.chipStagger + n * DUR.chipGap;
  return (
    <div className="flex items-center gap-1.5">
      {draft.needsProject && (
        <PopIn delay={delay(0)}>
          <ProjectChip index={index} />
        </PopIn>
      )}
      <PopIn delay={delay(0)}>
        <TaskStatusChip
          value={row.status}
          onChange={(status) => draft.setRow(index, { status })}
          ariaLabel={`Status for ${item.text}`}
        />
      </PopIn>
      <PopIn delay={delay(1)}>
        <OwnerChip index={index} />
      </PopIn>
      <PopIn delay={delay(2)}>
        <DueChip index={index} />
      </PopIn>
      <PopIn delay={delay(3)}>
        <button
          type="button"
          onClick={() => void draft.createOne(index)}
          disabled={draft.busy || !draft.canAdd(index)}
          aria-label={`Add task: ${item.text}`}
          className={cn(CHIP_BASE, "inline-flex items-center gap-1 border-os-accent/40 bg-os-accent/10 text-os-accent hover:bg-os-accent/20 disabled:opacity-50")}
        >
          <Plus className="h-3.5 w-3.5" aria-hidden />
          Add
        </button>
      </PopIn>
      <IconButton
        label={`Dismiss suggestion: ${item.text}`}
        icon={X}
        onClick={() => draft.dismissLine(index)}
        disabled={draft.busy}
      />
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
 * Status, owner and due chips, Add and dismiss at the right edge of each
 * suggestion line that matches one of the plan's action items. A React overlay driven by the plan: nothing
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
      const lines = findSuggestionLines(recRef.current.getNoteState?.()?.blocks ?? [], items);
      const next: Placement[] = [];
      const host = overlayHost(root!);
      if (!host) return;
      const hostRect = host.getBoundingClientRect();
      for (let index = 0; index < items.length; index++) {
        const block = lines[index];
        if (!block || items[index]!.taskId) continue;
        const el = findBlock(root!, block.id);
        if (!el) continue;
        const content = contentOf(el);
        resize?.observe(content);
        const box = toHost(content.getBoundingClientRect(), hostRect);
        next.push({ index, id: block.id, box, fromRight: hostRect.width - box.right + 8 });
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
    window.addEventListener("resize", frame.run);
    return () => {
      frame.cancel();
      resize?.disconnect();
      mutation.disconnect();
      window.removeEventListener("resize", frame.run);
    };
  }, [root, itemsKey, rec.noteVersion]);

  const host = root ? overlayHost(root) : null;
  if (!draft || !host || placements.length === 0) return null;

  return createPortal(
    <>
      {placements.map(({ index, box, fromRight }, order) => (
        <ChipGroup
          key={index}
          index={index}
          onSize={reportSize}
          style={
            narrow
              ? { position: "absolute", top: box.bottom - 32, left: box.left + 28 }
              : { position: "absolute", top: box.top + 1, right: fromRight }
          }
        >
          <ItemChips index={index} order={order} />
        </ChipGroup>
      ))}
    </>,
    host,
  );
}
