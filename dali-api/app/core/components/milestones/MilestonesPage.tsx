import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams, useSubmit } from "react-router";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  pointerWithin,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ChevronLeft, ChevronRight, GripVertical, MoreHorizontal, Plus } from "lucide-react";
import { OsPageHeader } from "~/components/os-section";
import { useOsChrome } from "~/components/os-chrome";
import { Button } from "~/components/ui/Button";
import { IconButton } from "~/components/ui/IconButton";
import { useDialog } from "~/components/ui/dialog";
import { Menu, MenuItem, MultiSelect } from "~/components/ui/floating";
import { cn } from "~/lib/cn";
import {
  MILESTONE_WEEKS,
  itemsFor,
  reorder,
  weekRange,
  weekSummary,
  type MilestoneItem,
  type MilestoneKind,
} from "~/core/lib/milestones";

type TermInfo = { id: string; code: string; label: string; startMs: number; endMs: number };
type Member = { id: string; name: string };

export type MilestonesPageData = {
  terms: TermInfo[];
  term: TermInfo | null;
  prevCode: string | null;
  nextCode?: string | null;
  nextExists?: boolean;
  items?: MilestoneItem[];
  members?: Member[];
  currentWeek?: number | null;
  selectedWeek?: number;
  lastYear?: { code: string; label: string } | null;
  lastYearItems?: MilestoneItem[];
  missingLabel: string | null;
  isAdmin: boolean;
};

const DATE_FMT = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const fmt = (ms: number) => DATE_FMT.format(new Date(ms));
const weekName = (w: number) => `W${w}`;
const weekId = (w: number) => `week:${w}`;

type Send = (fields: Record<string, string | string[]>) => void;

function useSend(): Send {
  const submit = useSubmit();
  const counter = useRef(0);
  return (fields) => {
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) {
      if (Array.isArray(v)) v.forEach((x) => form.append(k, x));
      else form.set(k, v);
    }
    counter.current += 1;
    submit(form, { method: "post", navigate: false, fetcherKey: `ms-${counter.current}` });
  };
}

export function MilestonesPage({ page }: { page: MilestonesPageData }) {
  const { os } = useOsChrome();
  return (
    <div className="flex flex-col gap-6">
      <OsPageHeader title="Milestones" description="Goals and plans for each week of the term." />
      <TermToolbar page={page} />
      {page.term ? (
        <TermBody key={page.term.id} page={page} />
      ) : (
        <div className={cn(os && "rounded-os-card bg-os-card", "p-8 text-center text-sm text-os-grey")}>
          <p>{page.missingLabel} isn't set up yet. An admin needs to add the term first.</p>
        </div>
      )}
    </div>
  );
}

function TermToolbar({ page }: { page: MilestonesPageData }) {
  const [params] = useSearchParams();
  const to = (code: string | null | undefined) => {
    const next = new URLSearchParams(params);
    next.delete("week");
    if (code) next.set("term", code);
    return `?${next.toString()}`;
  };
  const term = page.term;
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex items-center gap-1">
        {page.prevCode ? (
          <Link to={to(page.prevCode)} aria-label="Previous term" className="rounded-md p-1.5 text-os-grey hover:bg-os-hover">
            <ChevronLeft className="h-4 w-4" aria-hidden />
          </Link>
        ) : (
          <span className="p-1.5 text-os-muted">
            <ChevronLeft className="h-4 w-4" aria-hidden />
          </span>
        )}
        <span className="min-w-24 text-center font-heading text-lg font-semibold text-foreground">
          {term ? term.label : page.missingLabel}
        </span>
        {term && page.nextCode ? (
          <Link to={to(page.nextCode)} aria-label="Next term" className="rounded-md p-1.5 text-os-grey hover:bg-os-hover">
            <ChevronRight className="h-4 w-4" aria-hidden />
          </Link>
        ) : (
          <span className="p-1.5 text-os-muted">
            <ChevronRight className="h-4 w-4" aria-hidden />
          </span>
        )}
      </div>
      {term && (
        <span className="text-sm text-os-grey">
          {fmt(term.startMs)} to {fmt(term.endMs)}
        </span>
      )}
    </div>
  );
}

const collision: CollisionDetection = (args) => {
  const within = pointerWithin(args).filter((c) => String(c.id).startsWith("week:"));
  return within.length > 0 ? within : closestCenter(args);
};

function TermBody({ page }: { page: MilestonesPageData }) {
  const term = page.term!;
  const send = useSend();
  const { os } = useOsChrome();
  const [params, setParams] = useSearchParams();
  const [items, setItems] = useState<MilestoneItem[]>(page.items ?? []);
  useEffect(() => setItems(page.items ?? []), [page.items]);
  const selected = (() => {
    const raw = params.get("week");
    const n = raw !== null && /^\d+$/.test(raw) ? Number(raw) : NaN;
    return n >= 0 && n <= 10 ? n : (page.selectedWeek ?? 0);
  })();
  const selectWeek = (w: number) => {
    const next = new URLSearchParams(params);
    next.set("week", String(w));
    setParams(next, { replace: true, preventScrollReset: true });
  };
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const [blank, setBlank] = useState(false);
  const empty = items.length === 0 && !blank;

  function onDragEnd(e: DragEndEvent) {
    const activeId = String(e.active.id);
    const overId = e.over ? String(e.over.id) : null;
    const dragged = items.find((i) => i.id === activeId);
    if (!dragged || !overId) return;
    if (overId.startsWith("week:")) {
      const toWeek = Number(overId.slice(5));
      if (toWeek === dragged.week) return;
      const end = itemsFor(items, toWeek, dragged.kind).length;
      setItems((cur) => cur.map((i) => (i.id === activeId ? { ...i, week: toWeek, position: end } : i)));
      send({ intent: "move", id: activeId, toWeek: String(toWeek) });
      return;
    }
    const over = items.find((i) => i.id === overId);
    if (!over || over.id === dragged.id || over.week !== dragged.week || over.kind !== dragged.kind) return;
    const section = itemsFor(items, dragged.week, dragged.kind);
    const toIndex = section.findIndex((i) => i.id === over.id);
    const next = reorder(section, dragged.id, toIndex);
    const positions = new Map(next.map((i, idx) => [i.id, idx]));
    setItems((cur) => cur.map((i) => (positions.has(i.id) ? { ...i, position: positions.get(i.id)! } : i)));
    send({ intent: "move", id: dragged.id, toWeek: String(dragged.week), toPosition: String(toIndex) });
  }

  const sorted = useMemo(
    () => [...items].sort((a, b) => a.week - b.week || a.position - b.position),
    [items],
  );

  return (
    <DndContext sensors={sensors} collisionDetection={collision} onDragEnd={onDragEnd}>
      <div className="flex flex-col gap-5">
        {empty && (
          <div className={cn(os && "rounded-os-card bg-os-card", "flex flex-wrap items-center gap-3 p-4 text-sm text-os-grey")}>
            <span>Nothing planned for {term.label} yet.</span>
            {page.lastYear && (
              <Button size="sm" onClick={() => send({ intent: "fill", termId: term.id })}>
                Fill from last year
              </Button>
            )}
            <Button size="sm" variant="secondary" onClick={() => setBlank(true)}>
              Start blank
            </Button>
          </div>
        )}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-11">
          {MILESTONE_WEEKS.map((w) => (
            <WeekCard
              key={w}
              week={w}
              term={term}
              items={sorted}
              isCurrent={page.currentWeek === w}
              isSelected={selected === w}
              onSelect={() => selectWeek(w)}
            />
          ))}
        </div>
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_18rem]">
          <WeekDetail
            term={term}
            week={selected}
            items={sorted}
            members={page.members ?? []}
            send={send}
          />
          <SideCards page={page} week={selected} items={sorted} />
        </div>
      </div>
    </DndContext>
  );
}

function WeekCard({
  week,
  term,
  items,
  isCurrent,
  isSelected,
  onSelect,
}: {
  week: number;
  term: TermInfo;
  items: MilestoneItem[];
  isCurrent: boolean;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: weekId(week) });
  const summary = weekSummary(items, week);
  const { startMs } = weekRange(term.startMs, week);
  return (
    <button
      ref={setNodeRef}
      type="button"
      onClick={onSelect}
      aria-pressed={isSelected}
      aria-label={`Week ${week}`}
      className={cn(
        "flex min-h-28 flex-col gap-1 rounded-os-card border p-2.5 text-left transition-colors",
        isCurrent ? "border-os-accent" : "border-transparent",
        isSelected ? "bg-os-container" : "bg-os-card hover:bg-os-card-hover",
        isOver && "ring-2 ring-os-accent",
      )}
    >
      <span className="flex items-baseline justify-between text-xs">
        <span className="font-semibold text-os-fg">{weekName(week)}</span>
        <span className="text-os-grey">{fmt(startMs)}</span>
      </span>
      {summary.titles.map((t, i) => (
        <span key={i} className="line-clamp-2 text-xs text-os-fg">
          {t}
        </span>
      ))}
      {summary.more > 0 && <span className="text-xs text-os-grey">+{summary.more} more</span>}
      {summary.titles.length === 0 && <span className="text-xs text-os-muted">No goal yet</span>}
      {summary.planned > 0 && <span className="mt-auto text-xs text-os-muted">{summary.planned} planned</span>}
    </button>
  );
}

function WeekDetail({
  term,
  week,
  items,
  members,
  send,
}: {
  term: TermInfo;
  week: number;
  items: MilestoneItem[];
  members: Member[];
  send: Send;
}) {
  const { os } = useOsChrome();
  const range = weekRange(term.startMs, week);
  return (
    <section className={cn(os && "rounded-os-card bg-os-card", "flex flex-col gap-6 p-5")}>
      <header>
        <h2 className="font-heading text-lg font-semibold text-foreground">
          Week {week}
          {week === 0 && <span className="ml-2 text-sm font-normal text-os-grey">before the term</span>}
        </h2>
        <p className="text-sm text-os-grey">
          {fmt(range.startMs)} to {fmt(range.endMs)}
        </p>
      </header>
      {(["Milestone", "Plan"] as const).map((kind) => (
        <Section
          key={kind}
          kind={kind}
          termId={term.id}
          week={week}
          items={itemsFor(items, week, kind)}
          members={members}
          send={send}
        />
      ))}
    </section>
  );
}

function Section({
  kind,
  termId,
  week,
  items,
  members,
  send,
}: {
  kind: MilestoneKind;
  termId: string;
  week: number;
  items: MilestoneItem[];
  members: Member[];
  send: Send;
}) {
  const [draft, setDraft] = useState(false);
  const isPlan = kind === "Plan";
  useEffect(() => setDraft(false), [week]);
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-os-grey">{isPlan ? "Plan" : "Milestones"}</h3>
      <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
        <ul className="flex flex-col gap-1">
          {items.map((item) => (
            <ItemRow key={item.id} item={item} members={members} send={send} />
          ))}
        </ul>
      </SortableContext>
      {draft && (
        <DraftRow
          isPlan={isPlan}
          onSubmit={(title, more) => {
            send({ intent: "create", termId, week: String(week), kind, title });
            if (!more) setDraft(false);
          }}
          onCancel={() => setDraft(false)}
        />
      )}
      {!draft && (
        <button
          type="button"
          onClick={() => setDraft(true)}
          className="flex w-fit items-center gap-1.5 rounded-md px-1.5 py-1 text-sm text-os-grey hover:bg-os-hover hover:text-os-fg"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden />
          {isPlan ? "Add to plan" : "Add a milestone"}
        </button>
      )}
    </div>
  );
}

function DraftRow({
  isPlan,
  onSubmit,
  onCancel,
}: {
  isPlan: boolean;
  onSubmit: (title: string, addAnother: boolean) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState("");
  return (
    <input
      autoFocus
      value={value}
      onChange={(e) => setValue(e.target.value)}
      placeholder={isPlan ? "What needs to happen" : "What is the goal"}
      aria-label={isPlan ? "New plan item" : "New milestone"}
      className="w-full rounded-md bg-os-well px-2.5 py-1.5 text-sm text-os-fg outline-none focus:ring-2 focus:ring-os-accent"
      onKeyDown={(e) => {
        if (e.key === "Escape") onCancel();
        if (e.key === "Enter" && value.trim()) {
          onSubmit(value.trim(), isPlan);
          setValue("");
        }
      }}
      onBlur={() => {
        if (value.trim()) onSubmit(value.trim(), false);
        else onCancel();
      }}
    />
  );
}

function ItemRow({ item, members, send }: { item: MilestoneItem; members: Member[]; send: Send }) {
  const dialog = useDialog();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });
  const [title, setTitle] = useState(item.title);
  const [notes, setNotes] = useState(item.notes ?? "");
  const [showNotes, setShowNotes] = useState(Boolean(item.notes));
  useEffect(() => setTitle(item.title), [item.title]);
  useEffect(() => setNotes(item.notes ?? ""), [item.notes]);

  const savedNotes = useRef(item.notes ?? "");
  savedNotes.current = item.notes ?? "";
  useEffect(() => {
    if (notes === savedNotes.current) return;
    const t = setTimeout(() => send({ intent: "update", id: item.id, notes }), 700);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notes]);

  function commitTitle() {
    const next = title.trim();
    if (next === item.title) return;
    send({ intent: "update", id: item.id, title: next });
  }

  async function moveToWeek() {
    const picked = await dialog.choice({
      title: "Move to week",
      options: MILESTONE_WEEKS.map((w) => ({ value: String(w), label: `Week ${w}` })),
      selected: String(item.week),
    });
    if (picked !== null) send({ intent: "move", id: item.id, toWeek: picked });
  }

  const isPlan = item.kind === "Plan";
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : undefined }}
      className="rounded-md bg-os-well px-2 py-1.5"
    >
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-label="Drag to reorder"
          className="cursor-grab text-os-muted hover:text-os-grey"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-4 w-4" aria-hidden />
        </button>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={commitTitle}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          aria-label="Title"
          className="min-w-0 flex-1 bg-transparent text-sm text-os-fg outline-none focus:ring-2 focus:ring-os-accent"
        />
        <div className="w-44 shrink-0">
          <MultiSelect
            values={item.owners.map((o) => o.id)}
            options={members.map((m) => ({ value: m.id, label: m.name }))}
            placeholder="Whole lab"
            ariaLabel="Owners"
            align="right"
            onChange={(ids) => send({ intent: "update", id: item.id, ownerIds: ids, ownersTouched: "1" })}
          />
        </div>
        <Menu
          align="right"
          ariaLabel="Item actions"
          trigger={<IconButton label="More" icon={MoreHorizontal} />}
        >
          <MenuItem onSelect={moveToWeek}>Move to week…</MenuItem>
          <MenuItem onSelect={() => setShowNotes(true)}>Add notes</MenuItem>
          <MenuItem onSelect={() => send({ intent: "update", id: item.id, kind: isPlan ? "Milestone" : "Plan" })}>
            {isPlan ? "Make it a milestone" : "Make it a plan item"}
          </MenuItem>
          <MenuItem destructive onSelect={() => send({ intent: "delete", id: item.id })}>
            Delete
          </MenuItem>
        </Menu>
      </div>
      {showNotes && (
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Notes"
          aria-label="Notes"
          rows={2}
          className="mt-1.5 w-full resize-y rounded-md bg-os-card px-2 py-1 text-sm text-os-fg outline-none focus:ring-2 focus:ring-os-accent"
        />
      )}
    </li>
  );
}

function SideCards({ page, week, items }: { page: MilestonesPageData; week: number; items: MilestoneItem[] }) {
  const { os } = useOsChrome();
  const card = cn(os && "rounded-os-card bg-os-card", "flex flex-col gap-2 p-4");
  const lastYearItems = (page.lastYearItems ?? []).filter((i) => i.week === week);
  const next = [week + 1, week + 2].filter((w) => w <= 10);
  return (
    <aside className="flex flex-col gap-4">
      <div className={card}>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-os-grey">
          Same week last year{page.lastYear ? ` · ${page.lastYear.label}` : ""}
        </h3>
        {!page.lastYear && <p className="text-sm text-os-muted">No term from last year.</p>}
        {page.lastYear && lastYearItems.length === 0 && <p className="text-sm text-os-muted">Nothing planned.</p>}
        {(["Milestone", "Plan"] as const).map((kind) =>
          lastYearItems
            .filter((i) => i.kind === kind)
            .map((i) => (
              <p key={i.id} className={cn("text-sm", kind === "Plan" ? "text-os-grey" : "text-os-fg")}>
                {i.title}
              </p>
            )),
        )}
      </div>
      <div className={card}>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-os-grey">Next up</h3>
        {next.length === 0 && <p className="text-sm text-os-muted">This is the last week.</p>}
        {next.map((w) => {
          const ms = itemsFor(items, w, "Milestone");
          return (
            <div key={w}>
              <p className="text-xs text-os-grey">Week {w}</p>
              {ms.length === 0 ? (
                <p className="text-sm text-os-muted">No milestones</p>
              ) : (
                ms.map((m) => (
                  <p key={m.id} className="text-sm text-os-fg">
                    {m.title}
                  </p>
                ))
              )}
            </div>
          );
        })}
      </div>
    </aside>
  );
}
