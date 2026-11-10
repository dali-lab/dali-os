import type { MouseEvent } from "react";
import { TaskStatusDot, updateTaskCard, useFreshTaskCard, type CardTask } from "../schema/TaskMentionHoverCard";
import { useToast } from "~/components/ui/toast";
import { TaskDueChip, TaskOwnerChip, TaskStatusChip } from "~/components/tasks/TaskFieldChips";
import { Avatar } from "~/components/ui/Avatar";
import { cn } from "~/lib/cn";
import { TASK_STATUS_LABELS, type TaskStatus } from "~/projects/lib/task-board";
import { dueDateToIso, dueIsoToDate, moveTask, patchTask, useProjectTeam } from "./task-api";

// Chips read as plain text until the row is hovered or a chip has focus.
const QUIET_CHIP =
  "h-7 rounded-full border !border-transparent !bg-transparent px-2.5 text-[13px] text-muted-foreground group-hover/task:!border-border group-hover/task:!bg-card group-hover/task:text-foreground focus-within:!border-os-accent [&_svg]:hidden";

const SETTLED: TaskStatus[] = ["Done", "Cancelled"];

function taskHref(projectId: string, taskId: string): string {
  return `/projects/${projectId}?tab=progress&task=${taskId}`;
}

/** "Nov 7", read in UTC because task dates are stored as UTC midnight. */
export function formatTaskDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

export function isTaskOverdue(task: Pick<CardTask, "dueAt" | "status">, now: Date): boolean {
  if (!task.dueAt || SETTLED.includes(task.status)) return false;
  return task.dueAt.slice(0, 10) < now.toISOString().slice(0, 10);
}

function ownerLabel(task: CardTask): string {
  const extra = task.assignees.length - 1;
  return `${task.assignees[0]?.name ?? ""}${extra > 0 ? ` +${extra}` : ""}`;
}

function StaticFields({ task, href }: { task: CardTask; href: string }) {
  const overdue = isTaskOverdue(task, new Date());
  return (
    <>
      {task.assignees[0] && (
        <span className="flex w-32 shrink-0 items-center gap-1.5 pl-1 text-[13px] leading-6 text-muted-foreground">
          <Avatar name={task.assignees[0].name} size="xs" />
          {href ? (
            <a href={href} className="truncate hover:underline">
              {ownerLabel(task)}
            </a>
          ) : (
            <span className="truncate">{ownerLabel(task)}</span>
          )}
        </span>
      )}
      {task.dueAt && (
        <span className={cn("w-20 shrink-0 text-right text-[13px] leading-6", overdue ? "font-semibold text-os-danger" : "text-muted-foreground")}>
          {formatTaskDate(task.dueAt)}
        </span>
      )}
    </>
  );
}

function EditableFields({ task, projectId }: { task: CardTask; projectId: string }) {
  const toast = useToast();
  const team = useProjectTeam(projectId);
  const href = taskHref(projectId, task.id);

  async function apply(next: Partial<CardTask>, save: () => Promise<void>) {
    const undo = updateTaskCard(task.id, next);
    await save().catch((err: unknown) => {
      undo();
      toast.error(err instanceof Error ? err.message : "Couldn't save the task.");
    });
  }

  // assigneeIds replaces the whole set, so a task with co-owners is edited in
  // the task itself rather than risk dropping someone from here.
  const owner =
    task.assignees.length > 1 ? (
      <StaticFields task={{ ...task, dueAt: null }} href={href} />
    ) : (
      <div className="w-32 shrink-0">
        <TaskOwnerChip
          value={task.assignees[0]?.id ?? ""}
          name={task.assignees[0]?.name ?? ""}
          roster={team}
          rosterLabel="On this project"
          onChange={(id, name) => {
            const assignees = [{ id, name }];
            void apply({ assignees, assignee: { name } }, () => patchTask(task.id, { assigneeIds: [id] }));
          }}
          ariaLabel={`Owner of ${task.title}`}
          className={cn("w-full", QUIET_CHIP)}
        />
      </div>
    );

  return (
    <>
      {owner}
      <TaskDueChip
        value={dueIsoToDate(task.dueAt)}
        onChange={(date) => {
          const dueAt = dueDateToIso(date);
          void apply({ dueAt }, () => patchTask(task.id, { dueAt }));
        }}
        ariaLabel={`Due date of ${task.title}`}
        className="w-28 shrink-0"
        buttonClassName={cn(QUIET_CHIP, "!justify-end", isTaskOverdue(task, new Date()) && "font-semibold text-os-danger")}
      />
    </>
  );
}

function StatusField({ task, editable }: { task: CardTask; editable: boolean }) {
  const toast = useToast();
  if (!editable) {
    return (
      <span className="flex w-[104px] shrink-0 items-center gap-1.5 pl-2.5 text-[13px] leading-6 text-muted-foreground">
        <TaskStatusDot status={task.status} className="h-2 w-2" />
        {TASK_STATUS_LABELS[task.status]}
      </span>
    );
  }
  return (
    <div className="w-[104px] shrink-0">
      <TaskStatusChip
        value={task.status}
        onChange={(status) => {
          if (status === task.status) return;
          const undo = updateTaskCard(task.id, { status });
          void moveTask(task.id, status).catch((err: unknown) => {
            undo();
            toast.error(err instanceof Error ? err.message : "Couldn't change the status.");
          });
        }}
        ariaLabel={`Status of ${task.title}`}
        className={cn(QUIET_CHIP, "w-full !justify-start")}
      />
    </div>
  );
}

/** A press in the row must not move the text selection: ProseMirror would
 *  rebuild the block and any picker open inside it would go too. Only the owner
 *  field's input needs the press, to take focus. */
function keepSelection(e: MouseEvent<HTMLDivElement>) {
  const target = e.target as Element;
  if (e.currentTarget.contains(target) && target.tagName !== "INPUT") e.preventDefault();
}

/** One task as a line of a document: status, title, owner and date, all live.
 *  `label` is the saved title, which is all a reader without access sees. */
export function TaskBlockView({
  taskId,
  projectId,
  label,
  editable,
  docProjectId,
}: {
  taskId: string;
  projectId: string;
  label: string;
  editable: boolean;
  /** The surrounding doc's project. Undefined when the surface doesn't say. */
  docProjectId?: string | null;
}) {
  const card = useFreshTaskCard(taskId);
  const task = card === "loading" ? null : card;
  const title = task?.title || label || "Untitled task";

  if (!task) {
    return (
      <div className="dali-task group/task flex items-start gap-2.5 rounded-lg py-1.5" contentEditable={false}>
        <span className="flex h-6 w-[104px] shrink-0 items-center pl-2.5">
          <TaskStatusDot status={null} className="h-2 w-2" />
        </span>
        <span className="text-[15px] font-medium leading-6 text-muted-foreground">{title}</span>
      </div>
    );
  }

  const settled = SETTLED.includes(task.status);
  const href = taskHref(projectId, taskId);
  const elsewhere = docProjectId !== undefined && docProjectId !== projectId;

  return (
    <div
      className="dali-task group/task flex w-full flex-wrap items-start gap-x-2.5 gap-y-1 rounded-lg py-1 hover:bg-os-hover"
      contentEditable={false}
      data-task-id={taskId}
      onMouseDown={keepSelection}
    >
      <StatusField task={task} editable={editable} />
      <a
        href={href}
        className={cn(
          "min-w-0 flex-[1_1_12rem] py-0.5 text-[15px] font-medium leading-6 !no-underline hover:!underline",
          settled ? "!text-muted-foreground" : "!text-foreground",
        )}
      >
        {title}
      </a>
      {elsewhere && <span className="shrink-0 py-0.5 text-[13px] leading-6 text-muted-foreground">{task.projectName}</span>}
      <div className="ml-auto flex shrink-0 items-start gap-2.5">
        {editable ? <EditableFields task={task} projectId={projectId} /> : <StaticFields task={task} href={href} />}
      </div>
    </div>
  );
}
