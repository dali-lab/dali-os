import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { DragEndEvent } from "@dnd-kit/core";
import {
  ArrowRight,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CornerUpLeft,
  ExternalLink,
  Maximize2,
  Minimize2,
  Play,
  Plus,
  RotateCcw,
  Trash2,
  X,
} from "lucide-react";
import { KanbanBoard, type KanbanColumn } from "~/components/board/KanbanBoard";
import { Avatar } from "~/components/ui/Avatar";
import { Segmented } from "~/components/ui/Segmented";
import { useDialog } from "~/components/ui/dialog";
import { Select } from "~/components/ui/floating/Select";
import { cn } from "~/lib/cn";
import {
  backlogCount,
  buildBacklogGroups,
  groupMeta,
  isGroupRelevant,
  type BacklogGroup,
  type BacklogScope,
} from "~/education/lib/taskboard/backlog-groups";
import { doneToggleLabel, doneView, railCount } from "~/education/lib/taskboard/done-list";
import { rolloverBanner, taskMeta } from "~/education/lib/taskboard/labels";
import {
  countRolledOver,
  placeTasksInWeek,
  rolledFromLabel,
  type PlacedTask,
  type TaskStatus,
} from "~/education/lib/taskboard/rollover";
import type { StoredTask } from "~/education/lib/taskboard/taskboard.server";
import type { WeekRef } from "~/education/lib/taskboard/weeks";
import { WEEKDAYS } from "~/education/lib/taskboard/labels";
import { assigneeNames } from "~/education/lib/taskboard/assignees";
import { WeekHeader } from "./WeekHeader";
import type { Dialog, Submit, TaskboardData } from "./types";

type Placed = PlacedTask<StoredTask>;

type Item =
  | { kind: "task"; id: string; task: Placed }
  | { kind: "group"; id: string; group: BacklogGroup<Placed>; open: boolean }
  | { kind: "empty"; id: string; text: string }
  | { kind: "done-toggle"; id: string }
  | { kind: "done-note"; id: string };

const STATUS_DOT: Record<TaskStatus, string> = {
  Backlog: "bg-os-container-hi",
  Todo: "bg-os-container-hi",
  Doing: "bg-os-amber",
  Done: "bg-os-green",
};

const SCOPES = [
  { value: "term", label: "This term" },
  { value: "year", label: "Whole year" },
];

const PILL =
  "inline-flex h-7 items-center gap-1 rounded-full bg-(--tb-accent-tint) px-2.5 text-xs font-semibold text-os-fg hover:bg-os-card-hover";
const RAIL = "flex w-14 shrink-0 flex-col items-center rounded-os-card bg-os-card";
const LIST = "flex min-h-[320px] max-h-[68vh] flex-col gap-2 overflow-y-auto pr-1";
const COLUMN = "flex min-w-[260px] flex-1 flex-col rounded-os-card bg-os-card p-4";

const COLUMN_STATUSES: TaskStatus[] = ["Backlog", "Todo", "Doing", "Done"];

const DISMISS_KEY = "education-taskboard:dismissed-rollover";

function readDismissed(): Set<string> {
  try {
    const raw = window.localStorage.getItem(DISMISS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : []);
  } catch {
    return new Set();
  }
}

function writeDismissed(keys: Set<string>) {
  try {
    window.localStorage.setItem(DISMISS_KEY, JSON.stringify([...keys]));
  } catch {
    return;
  }
}

function opensTask(event: { target: EventTarget | null; currentTarget: EventTarget | null }): boolean {
  const target = event.target as HTMLElement | null;
  const hit = target?.closest("button, a, input, select, textarea");
  return !hit || hit === event.currentTarget;
}

export function WeekView({
  data,
  reveal,
  everyone,
  onEveryoneChange,
  openDialog,
  goTo,
  submit,
}: {
  data: TaskboardData;
  reveal?: { key: string; nonce: number } | null;
  everyone: boolean;
  onEveryoneChange: (everyone: boolean) => void;
  openDialog: (d: Dialog) => void;
  goTo: (ref: WeekRef) => void;
  submit: Submit;
}) {
  const { periods, tasks, milestones, members, current, viewed, userId } = data;
  const dialog = useDialog();
  const [scope, setScope] = useState<BacklogScope>("term");
  const [backlogOpen, setBacklogOpen] = useState(true);
  const [groupToggles, setGroupToggles] = useState<Record<string, boolean>>({});
  const [doneOpen, setDoneOpen] = useState(false);
  const [doneAll, setDoneAll] = useState(false);
  const [doneWide, setDoneWide] = useState(false);
  const [dismissedBanners, setDismissedBanners] = useState<Set<string>>(() => readDismissed());

  useEffect(() => {
    if (!reveal) return;
    setGroupToggles((prev) => ({ ...prev, [reveal.key]: true }));
    setBacklogOpen(true);
  }, [reveal]);

  const memberById = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);
  const msName = useMemo(() => new Map(milestones.map((m) => [m.id, m.name])), [milestones]);
  const periodShort = useMemo(() => new Map(periods.map((p) => [p.id, p.shortName])), [periods]);

  const placed = useMemo<Placed[]>(
    () => (viewed && current ? placeTasksInWeek({ tasks, periods, viewed, current }) : []),
    [tasks, periods, viewed, current],
  );

  if (!viewed || !current || !periods.some((p) => p.id === viewed.periodId)) {
    return <p className="text-os-grey">Add a term to start planning.</p>;
  }

  const mine = (t: StoredTask) => everyone || t.assigneeIds.includes(userId);
  const onCurrentWeek = viewed.periodId === current.periodId && viewed.week === current.week;
  const rolled = placed.filter((t) => t.rolledFrom);
  const sources = new Set(rolled.map((t) => `${t.rolledFrom!.periodId}:${t.rolledFrom!.week}`));
  const bannerKey = `${viewed.periodId}:${viewed.week}`;
  const banner = onCurrentWeek && !dismissedBanners.has(bannerKey)
    ? rolloverBanner(countRolledOver(placed), sources.size === 1 ? rolled[0].rolledFrom!.week : null)
    : null;

  const groups = buildBacklogGroups<Placed>({
    tasks: tasks.map((t) => ({ ...t, rolledFrom: null })),
    milestones,
    scope,
    periodId: viewed.periodId,
    show: (t) => everyone || t.assigneeIds.includes(userId) || t.assigneeIds.length === 0,
  });
  const waiting = backlogCount(groups);

  const weekTasks = (status: TaskStatus) => placed.filter((t) => t.status === status && mine(t));
  const done = doneView(weekTasks("Done"), doneAll);

  const move = (task: StoredTask, status: TaskStatus) =>
    submit({ intent: "task-move", id: task.id, status, periodId: viewed.periodId, week: String(viewed.week) });

  const remove = async (task: StoredTask) => {
    const ok = await dialog.confirm({
      title: "Delete this task?",
      description: "It can't be undone.",
      confirmLabel: "Delete task",
      tone: "destructive",
    });
    if (ok) submit({ intent: "task-delete", id: task.id });
  };

  const isOpen = (g: BacklogGroup<Placed>) => groupToggles[g.key] ?? isGroupRelevant(g, viewed);
  const dismissBanner = () =>
    setDismissedBanners((prev) => {
      const next = new Set(prev).add(bannerKey);
      writeDismissed(next);
      return next;
    });

  const toggleGroup = (g: BacklogGroup<Placed>) => setGroupToggles((prev) => ({ ...prev, [g.key]: !isOpen(g) }));

  const backlogItems: Item[] = groups.flatMap((g): Item[] => {
    const open = isOpen(g);
    const head: Item = { kind: "group", id: `group:${g.key}`, group: g, open };
    if (!open) return [head];
    if (g.rows.length === 0) {
      return [head, { kind: "empty", id: `empty:${g.key}`, text: "Nothing waiting. All tasks are planned or done." }];
    }
    return [head, ...g.rows.map((t): Item => ({ kind: "task", id: t.id, task: t }))];
  });

  const doneItems: Item[] = [
    ...done.rows.map((t): Item => ({ kind: "task", id: t.id, task: t })),
    ...(done.canToggle ? [{ kind: "done-toggle", id: "done-toggle" } as Item] : []),
    { kind: "done-note", id: "done-note" },
  ];

  const railLabel = (text: string, onClick: () => void, label: string) => () => (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="flex items-center gap-1 text-sm font-semibold text-os-grey [writing-mode:vertical-rl] hover:text-os-fg"
    >
      {text}
      <ChevronRight className="h-3.5 w-3.5 rotate-90" aria-hidden />
    </button>
  );

  const countBadge = (n: number) => {
    const c = railCount(n);
    return (
      <span className={cn("font-bold text-os-fg", c.small ? "text-xs" : "text-sm")}>{c.label}</span>
    );
  };

  const dot = (status: TaskStatus) => <span className={cn("h-2 w-2 rounded-full", STATUS_DOT[status])} aria-hidden />;
  const heading = (status: TaskStatus, text: string): ReactNode => (
    <span className="inline-flex items-center gap-2">
      {dot(status)}
      {text}
    </span>
  );

  const railColumn = (
    id: TaskStatus,
    count: number,
    label: string,
    open: () => void,
    openLabel: string,
  ): KanbanColumn<Item> => ({
    id,
    title: undefined,
    cards: [],
    className: cn(RAIL, id === "Done" && "border border-os-container bg-os-bg"),
    headerClassName: "flex flex-col items-center px-0 py-3",
    headerExtra: countBadge(count),
    listClassName: "flex flex-1 justify-center py-2",
    renderEmpty: railLabel(label, open, openLabel),
  });

  const addTask = (status: "Todo" | "Doing") => (
    <button
      type="button"
      onClick={() =>
        openDialog({
          kind: "task",
          taskId: null,
          draft: { status, assigneeIds: [userId], periodId: viewed.periodId, week: viewed.week },
        })
      }
      className="mb-1 flex w-full items-center gap-1.5 rounded-os-item px-2.5 py-2 text-sm text-os-muted opacity-60 transition hover:bg-os-hover hover:opacity-100 focus-visible:opacity-100"
    >
      <Plus className="h-4 w-4" aria-hidden />
      Add task
    </button>
  );

  const columns: KanbanColumn<Item>[] = [
    backlogOpen
      ? {
          id: "Backlog",
          title: heading("Backlog", "Backlog"),
          cards: backlogItems,
          className: "flex w-[380px] shrink-0 flex-col rounded-os-card bg-os-card p-4",
          headerClassName: "flex items-center justify-between gap-2 pb-3",
          headerExtra: (
            <span className="flex items-center gap-1">
              <Select
                ariaLabel="Backlog scope"
                value={scope}
                onChange={(v) => setScope(v as BacklogScope)}
                options={SCOPES}
                buttonClassName="h-[30px] rounded-full px-3 text-xs"
              />
              <button
                type="button"
                aria-label="Collapse backlog"
                className="os-icon-btn"
                onClick={() => setBacklogOpen(false)}
              >
                <ChevronLeft className="h-4 w-4" aria-hidden />
              </button>
            </span>
          ),
          listClassName: LIST,
        }
      : railColumn("Backlog", waiting, "Backlog", () => setBacklogOpen(true), "Expand backlog"),
    {
      id: "Todo",
      title: heading("Todo", "To do"),
      cards: weekTasks("Todo").map((t) => ({ kind: "task", id: t.id, task: t })),
      className: COLUMN,
      headerClassName: "flex items-center justify-between pb-3",
      listClassName: LIST,
      listHeader: addTask("Todo"),
      renderEmpty: () => <p className="py-6 text-center text-sm text-os-grey">Nothing assigned yet. Pull from the backlog.</p>,
    },
    {
      id: "Doing",
      title: heading("Doing", "In progress"),
      cards: weekTasks("Doing").map((t) => ({ kind: "task", id: t.id, task: t })),
      className: COLUMN,
      headerClassName: "flex items-center justify-between pb-3",
      listClassName: LIST,
      listHeader: addTask("Doing"),
      renderEmpty: () => <p className="py-6 text-center text-sm text-os-grey">Nothing started</p>,
    },
    doneOpen
      ? {
          id: "Done",
          title: heading("Done", "Done"),
          cards: doneItems,
          className: cn(
            "flex min-w-[260px] flex-col rounded-os-card border border-os-container bg-os-bg p-4",
            doneWide ? "flex-[3]" : "flex-1",
          ),
          headerClassName: "flex items-center justify-between gap-2 pb-3",
          headerExtra: (
            <span className="flex items-center gap-1">
              <button
                type="button"
                className="os-icon-btn"
                aria-label={doneWide ? "Shrink done" : "Expand done"}
                onClick={() => setDoneWide((v) => !v)}
              >
                {doneWide ? <Minimize2 className="h-4 w-4" aria-hidden /> : <Maximize2 className="h-4 w-4" aria-hidden />}
              </button>
              <button type="button" className="os-icon-btn" aria-label="Collapse done" onClick={() => setDoneOpen(false)}>
                <ChevronRight className="h-4 w-4" aria-hidden />
              </button>
            </span>
          ),
          listClassName: LIST,
          renderEmpty: () => <p className="py-6 text-center text-sm text-os-grey">Nothing done this week.</p>,
        }
      : railColumn("Done", done.total, "Done", () => setDoneOpen(true), "Open done"),
  ];

  const onDragEnd = (event: DragEndEvent) => {
    const to = event.over?.id as TaskStatus | undefined;
    const task = tasks.find((t) => t.id === event.active.id);
    if (!to || !task || to === task.status || !COLUMN_STATUSES.includes(to)) return;
    move(task, to);
  };

  const person = (id: string | null) => (id ? memberById.get(id) : undefined);
  const meta = (t: StoredTask) =>
    taskMeta({
      assignees: assigneeNames(t.assigneeIds, members),
      week: t.week,
      weekday: t.weekday,
      periodShort: t.periodId === viewed.periodId ? null : (periodShort.get(t.periodId) ?? null),
    });
  const me = memberById.get(userId);

  const renderItem = (item: Item, opts: { isDragging: boolean; dragHandleProps: Record<string, unknown> }) => {
    if (item.kind === "group") {
      const { group, open } = item;
      return (
        <div className={cn("flex items-center rounded-os-item", group.milestone ? "bg-(--tb-milestone-tint)" : "bg-os-bg")}>
          <button
            type="button"
            aria-expanded={open}
            onClick={() => toggleGroup(group)}
            className="flex h-[38px] min-w-0 flex-1 items-center gap-2 px-3 text-left text-sm"
          >
            {open ? <ChevronDown className="h-3.5 w-3.5 shrink-0" aria-hidden /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" aria-hidden />}
            <span className="truncate font-bold text-os-fg">{group.name}</span>
            <span className="ml-auto shrink-0 text-xs text-os-grey">{groupMeta(group)}</span>
          </button>
          {group.milestone && (
            <button
              type="button"
              className="os-icon-btn mr-1"
              aria-label={`Open ${group.name}`}
              onClick={() => openDialog({ kind: "milestone-detail", milestoneId: group.milestone!.id })}
            >
              <ExternalLink className="h-4 w-4" aria-hidden />
            </button>
          )}
        </div>
      );
    }
    if (item.kind === "empty") return <p className="px-3 py-2 text-sm text-os-grey">{item.text}</p>;
    if (item.kind === "done-toggle") {
      return (
        <button
          type="button"
          onClick={() => setDoneAll((v) => !v)}
          className="h-[34px] rounded-os-item border border-dashed border-os-container-hi text-[13px] font-bold text-os-accent hover:bg-os-card-hover"
        >
          {doneToggleLabel(done, doneAll)}
        </button>
      );
    }
    if (item.kind === "done-note") {
      return (
        <p className="px-1 text-xs text-os-grey">
          Only this week's done tasks show here. Older ones stay on the milestone and term view.
        </p>
      );
    }

    const task = item.task;
    const title = (extra?: string) => (
      <button
        type="button"
        className={cn("min-w-0 text-left font-semibold text-os-fg hover:underline", extra)}
        onClick={() => openDialog({ kind: "task", taskId: task.id })}
      >
        {task.title}
      </button>
    );

    if (task.status === "Backlog") {
      const nested = task.milestoneId !== null && msName.has(task.milestoneId);
      return (
        <div className={cn(nested && "ml-4 border-l-2 border-(--tb-milestone) pl-2")}>
          <div
            {...opts.dragHandleProps}
            onClick={(e) => opensTask(e) && openDialog({ kind: "task", taskId: task.id })}
            title="Drag into the week"
            className={cn(
              "flex cursor-grab items-center gap-2 rounded-os-item bg-os-bg p-2.5 text-sm active:cursor-grabbing",
              opts.isDragging && "opacity-40",
            )}
          >
            <div className="flex min-w-0 flex-1 flex-col">
              {title("truncate")}
              <span className="truncate text-xs text-os-grey">{meta(task)}</span>
            </div>
            {task.assigneeIds.length > 0 ? (
              <button type="button" className={PILL} onClick={() => move(task, "Todo")}>
                <ArrowRight className="h-3 w-3" aria-hidden />
                Wk {viewed.week}
              </button>
            ) : (
              <button type="button" aria-label="Pull in for me" className="rounded-full" onClick={() => move(task, "Todo")}>
                <Avatar name={me?.name ?? "Me"} photoUrl={me?.photoUrl ?? null} size="compact" />
              </button>
            )}
          </div>
        </div>
      );
    }

    if (task.status === "Done") {
      return (
        <div
          {...opts.dragHandleProps}
          onClick={(e) => opensTask(e) && openDialog({ kind: "task", taskId: task.id })}
          className={cn("flex cursor-pointer items-center gap-2 rounded-os-item bg-os-card p-2.5 text-sm", opts.isDragging && "opacity-40")}
        >
          <Check className="h-4 w-4 shrink-0 text-os-green" aria-hidden />
          {title("truncate text-os-grey line-through")}
          <button type="button" className={cn(PILL, "ml-auto")} onClick={() => move(task, "Doing")}>
            <RotateCcw className="h-3 w-3" aria-hidden />
            Undo
          </button>
          <button type="button" className="os-icon-btn" aria-label="Delete task" onClick={() => remove(task)}>
            <Trash2 className="h-4 w-4" aria-hidden />
          </button>
        </div>
      );
    }

    const assignees = task.assigneeIds.flatMap((id) => person(id) ?? []);
    return (
      <article
        {...opts.dragHandleProps}
        onClick={(e) => opensTask(e) && openDialog({ kind: "task", taskId: task.id })}
        className={cn(
          "flex cursor-pointer flex-col gap-2 rounded-os-item border border-os-container bg-os-bg p-3 text-sm",
          opts.isDragging && "opacity-40",
        )}
      >
        {title()}
        <div className="flex flex-wrap items-center gap-1.5">
          {task.milestoneId && msName.has(task.milestoneId) && (
            <span className="rounded-full bg-(--tb-milestone-tint) px-2 py-0.5 text-xs font-semibold text-(--tb-milestone)">
              {msName.get(task.milestoneId)}
            </span>
          )}
          {task.rolledFrom && (
            <span className="rounded-full bg-(--tb-amber-tint) px-2 py-0.5 text-xs font-semibold text-os-amber">
              {rolledFromLabel(task.rolledFrom, periods, viewed.periodId)}
            </span>
          )}
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 text-xs text-os-grey">
            {assignees.length > 0 ? (
              <span className="flex -space-x-1">
                {assignees.map((a) => (
                  <Avatar key={a.id} name={a.name} photoUrl={a.photoUrl} size="xs" />
                ))}
              </span>
            ) : (
              <span>Unassigned</span>
            )}
            <span>{WEEKDAYS[task.weekday]}</span>
          </span>
          <span className="flex gap-1">
            <button type="button" className={PILL} onClick={() => move(task, task.status === "Todo" ? "Backlog" : "Todo")}>
              <CornerUpLeft className="h-3 w-3" aria-hidden />
              {task.status === "Todo" ? "Backlog" : "Back"}
            </button>
            <button type="button" className={PILL} onClick={() => move(task, task.status === "Todo" ? "Doing" : "Done")}>
              {task.status === "Todo" ? <Play className="h-3 w-3" aria-hidden /> : <Check className="h-3 w-3" aria-hidden />}
              {task.status === "Todo" ? "Start" : "Done"}
            </button>
          </span>
        </div>
      </article>
    );
  };

  const renderOverlay = (activeId: string | null) => {
    if (!activeId) return null;
    const all = [...backlogItems, ...doneItems, ...columns.flatMap((c) => c.cards)];
    const item = all.find((i) => i.kind === "task" && i.id === activeId);
    if (!item) return null;
    return (
      <div className="w-[340px] rotate-1 rounded-os-item shadow-[0_16px_40px_var(--color-os-shadow)]" data-testid="drag-preview">
        {renderItem(item, { isDragging: false, dragHandleProps: {} })}
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <WeekHeader periods={periods} viewed={viewed} current={current} goTo={goTo} />
      <div className="min-h-[52px]">
        {banner && (
          <p className="flex min-h-[52px] items-center gap-2 rounded-os-item bg-(--tb-amber-tint) px-4 py-2.5 text-sm text-os-amber" role="status">
            <RotateCcw className="h-4 w-4 shrink-0" aria-hidden />
            <span className="flex-1">{banner}</span>
            <button type="button" onClick={dismissBanner} aria-label="Dismiss rollover notice" className="os-icon-btn text-os-amber">
              <X className="h-4 w-4" aria-hidden />
            </button>
          </p>
        )}
      </div>
      <Segmented<"everyone" | "me">
        ariaLabel="Whose tasks"
        className="self-start"
        value={everyone ? "everyone" : "me"}
        onChange={(v) => onEveryoneChange(v === "everyone")}
        options={[
          { value: "everyone", label: "Everyone" },
          { value: "me", label: "Just me" },
        ]}
      />
      <KanbanBoard<Item>
        id="education-taskboard-week"
        columns={columns}
        getCardId={(i) => i.id}
        getCardData={(i) => ({ kind: i.kind })}
        draggable
        onDragEnd={onDragEnd}
        renderCard={renderItem}
        renderOverlay={renderOverlay}
      />
    </div>
  );
}
