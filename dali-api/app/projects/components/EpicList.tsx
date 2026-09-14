import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "~/lib/cn";
import { Select } from "~/components/ui/floating";
import { ALL_TERMS, termFilterOrder } from "~/lib/terms.shared";
import {
  EPIC_STATUS_LABEL,
  OS_LEVEL,
  STORY_STATUS_LABEL,
  TASK_STATUS_LABEL,
  rangeLabel,
  type EpicStatus,
  type TimelineEpic,
  type TimelineStory,
} from "./EpicsTimeline";

const EPIC_STATUSES: EpicStatus[] = ["Backlog", "Open", "InProgress", "Done", "Cancelled"];
const ALL_STATUSES = "all" as const;

// The filters are toolbar controls, not form fields, so they wear the row's own
// pill (`.os-edit-btn`) rather than the select trigger — same height, radius and
// type as Edit and New beside them.
const FILTER_PILL = "os-edit-btn max-w-[220px]";

/** Done/total for a story: cancelled tasks are out of both numbers. */
function storyCounts(story: TimelineStory): { done: number; total: number } {
  const counted = story.tasks.filter((t) => t.status !== "Cancelled");
  return { done: counted.filter((t) => t.status === "Done").length, total: counted.length };
}

/**
 * The timeline's other half: the same epic → story → task tree read as an
 * outline rather than placed on a date grid. The grid answers "when"; this
 * answers "what is under this epic", which is the question a grid with bars
 * running off both edges is worst at.
 *
 * It opens on the current term because that is the work in flight — the whole
 * backlog is a term filter away, not the landing view.
 */
export function EpicList({
  epics,
  terms,
  epicTermIds,
  currentTermId,
  actions,
  onEpicClick,
  onStoryClick,
  onTaskClick,
}: {
  epics: TimelineEpic[];
  /** Term-filter options, newest first. */
  terms: { id: string; code: string }[];
  /** Terms each epic counts toward, keyed by epic id (see the loader). */
  epicTermIds?: Record<string, string[]>;
  currentTermId?: string | null;
  /** The toolbar's right-hand controls (view toggle, New) — this view draws
   *  its own header row, so it takes them the way the timeline does. */
  actions?: ReactNode;
  onEpicClick?: (epicId: string) => void;
  onStoryClick?: (epicId: string) => void;
  onTaskClick?: (taskId: string) => void;
}) {
  const termOptions = useMemo(
    () => termFilterOrder(terms.map((t) => ({ ...t, isCurrent: t.id === currentTermId }))),
    [terms, currentTermId],
  );
  // The current term when the project runs it, otherwise everything.
  const [termFilter, setTermFilter] = useState(() =>
    currentTermId && terms.some((t) => t.id === currentTermId) ? currentTermId : ALL_TERMS,
  );
  const [statusFilter, setStatusFilter] = useState<EpicStatus | typeof ALL_STATUSES>(
    ALL_STATUSES,
  );

  // Collapsed rather than expanded ids, so an epic added while the list is open
  // arrives showing its stories instead of folded shut.
  const [collapsedEpics, setCollapsedEpics] = useState<Set<string>>(new Set());
  const [openStories, setOpenStories] = useState<Set<string>>(new Set());
  const toggle = (set: Set<string>, id: string) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  };

  const shown = useMemo(
    () =>
      epics.filter((e) => {
        if (statusFilter !== ALL_STATUSES && e.status !== statusFilter) return false;
        if (termFilter === ALL_TERMS) return true;
        const ids = epicTermIds?.[e.id];
        // An epic with no dates, no sprints and no target term has no term
        // footprint at all. Hiding it behind every term filter would make it
        // reachable only by switching to "All terms" — so it stays listed.
        if (!ids || ids.length === 0) return true;
        return ids.includes(termFilter);
      }),
    [epics, statusFilter, termFilter, epicTermIds],
  );

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={termFilter}
          options={termOptions}
          onChange={setTermFilter}
          ariaLabel="Filter epics by term"
          buttonClassName={FILTER_PILL}
        />
        <Select
          value={statusFilter}
          options={[
            { value: ALL_STATUSES, label: "All statuses" },
            ...EPIC_STATUSES.map((s) => ({ value: s, label: EPIC_STATUS_LABEL[s] })),
          ]}
          onChange={(v) => setStatusFilter(v as EpicStatus | typeof ALL_STATUSES)}
          ariaLabel="Filter epics by status"
          buttonClassName={FILTER_PILL}
        />
        {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
      </div>

      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        {shown.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-os-muted">
            {epics.length === 0
              ? "No epics yet — add one to start planning."
              : "No epics match these filters."}
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {shown.map((epic) => {
              const open = !collapsedEpics.has(epic.id);
              return (
                <li key={epic.id}>
                  <Row
                    level="epic"
                    depth={0}
                    open={open}
                    expandable={epic.stories.length > 0}
                    onToggle={() => setCollapsedEpics((s) => toggle(s, epic.id))}
                    title={epic.title}
                    onTitleClick={onEpicClick && (() => onEpicClick(epic.id))}
                    status={EPIC_STATUS_LABEL[epic.status]}
                    dates={
                      epic.startsAt && epic.endsAt
                        ? rangeLabel(epic.startsAt, epic.endsAt)
                        : "Unscheduled"
                    }
                  />
                  {open &&
                    epic.stories.map((story) => {
                      const storyOpen = openStories.has(story.id);
                      return (
                        <div key={story.id}>
                          <Row
                            level="story"
                            depth={1}
                            open={storyOpen}
                            expandable={story.tasks.length > 0}
                            onToggle={() => setOpenStories((s) => toggle(s, story.id))}
                            title={story.title}
                            onTitleClick={
                              onStoryClick && (() => onStoryClick(epic.id))
                            }
                            status={STORY_STATUS_LABEL[story.status]}
                            dates={rangeLabel(story.startsAt, story.endsAt)}
                            counts={
                              story.tasks.length > 0 ? storyCounts(story) : null
                            }
                          />
                          {storyOpen &&
                            story.tasks.map((task) => (
                              <Row
                                key={task.id}
                                level="task"
                                depth={2}
                                expandable={false}
                                title={task.title}
                                onTitleClick={
                                  onTaskClick && (() => onTaskClick(task.id))
                                }
                                status={TASK_STATUS_LABEL[task.status]}
                                dates={rangeLabel(task.startsAt, task.endsAt)}
                                meta={
                                  task.assignees.length > 0
                                    ? task.assignees.map((a) => a.name).join(", ")
                                    : null
                                }
                              />
                            ))}
                        </div>
                      );
                    })}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

/** One line of the outline. The three levels differ only in indent, dot colour
 *  and type weight, so they read as one tree rather than three lists. */
function Row({
  level,
  depth,
  open = false,
  expandable,
  onToggle,
  title,
  onTitleClick,
  status,
  dates,
  counts,
  meta,
}: {
  level: "epic" | "story" | "task";
  depth: 0 | 1 | 2;
  open?: boolean;
  expandable: boolean;
  onToggle?: () => void;
  title: string;
  onTitleClick?: (() => void) | undefined;
  status: string;
  dates: string;
  counts?: { done: number; total: number } | null;
  meta?: string | null;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 px-4 py-2 transition-colors hover:bg-os-hover",
        depth > 0 && "border-t border-border/60",
        depth === 1 && "pl-10",
        depth === 2 && "pl-16",
      )}
    >
      {expandable ? (
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-label={open ? `Collapse ${title}` : `Expand ${title}`}
          className="os-icon-btn h-5 w-5 flex-shrink-0"
        >
          <ChevronRight
            className={cn("h-4 w-4 text-os-grey transition-transform", open && "rotate-90")}
            aria-hidden
          />
        </button>
      ) : (
        <span className="h-5 w-5 flex-shrink-0" aria-hidden />
      )}
      <span
        className="h-2 w-2 flex-shrink-0 rounded-full"
        style={{ background: OS_LEVEL[level].edge }}
        aria-hidden
      />
      {onTitleClick ? (
        <button
          type="button"
          onClick={onTitleClick}
          className={cn(
            "min-w-0 flex-1 truncate text-left text-sm text-foreground hover:underline",
            level === "epic" && "font-semibold",
          )}
        >
          {title}
        </button>
      ) : (
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-sm text-foreground",
            level === "epic" && "font-semibold",
          )}
        >
          {title}
        </span>
      )}
      {meta && (
        <span className="hidden max-w-[180px] flex-shrink-0 truncate text-xs text-os-grey md:inline">
          {meta}
        </span>
      )}
      {counts && (
        <span className="flex-shrink-0 text-xs tabular-nums text-os-grey">
          {counts.done}/{counts.total}
        </span>
      )}
      <span className="hidden flex-shrink-0 text-xs tabular-nums text-os-muted sm:inline">
        {dates}
      </span>
      <span className="flex-shrink-0 rounded-full border border-os-container px-2 py-0.5 text-[11px] font-semibold text-os-grey">
        {status}
      </span>
    </div>
  );
}
