import { useId, useState, type ReactNode } from "react";
import { AlignLeft, CalendarDays, Diamond, Flag, Users, X } from "lucide-react";
import { ModalFooter, ModalHeader } from "~/components/Modal";
import { PanelFrame } from "./PanelFrame";
import { Button } from "~/components/ui/Button";
import { useDialog } from "~/components/ui/dialog";
import { cn } from "~/lib/cn";
import type { DueRef } from "~/education/lib/taskboard/calendar";
import { createStatus } from "~/education/lib/taskboard/task-draft";
import type { TaskStatus } from "~/education/lib/taskboard/rollover";
import { AssigneePicker } from "./AssigneePicker";
import { DueDatePicker } from "./DueDatePicker";
import { MilestonePicker } from "./MilestonePicker";
import { PanelTabs } from "./PanelTabs";
import type { Dialog, Submit, TaskDraft, TaskboardData } from "./types";

const STATUS_CHIPS: { value: TaskStatus; label: string; dot: string }[] = [
  { value: "Backlog", label: "Backlog", dot: "bg-os-container-hi" },
  { value: "Todo", label: "To do", dot: "bg-os-container-hi" },
  { value: "Doing", label: "In progress", dot: "bg-os-amber" },
  { value: "Done", label: "Done", dot: "bg-os-green" },
];

function Row({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[28px_minmax(0,1fr)] items-start gap-x-4">
      <span className="flex h-[42px] items-center text-os-grey" role="img" aria-label={label}>
        {icon}
      </span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function TaskDialog({
  data,
  taskId,
  draft: seed,
  submit,
  onClose,
  openDialog,
  busy,
}: {
  data: TaskboardData;
  taskId: string | null;
  draft?: Partial<TaskDraft>;
  submit: Submit;
  onClose: () => void;
  openDialog: (d: Dialog) => void;
  busy: boolean;
}) {
  const { periods, milestones, members, tasks, viewed, userId, today } = data;
  const titleId = useId();
  const dialog = useDialog();
  const editing = taskId ? (tasks.find((t) => t.id === taskId) ?? null) : null;

  const [draft, setDraft] = useState<TaskDraft>(() => ({
    title: editing?.title ?? "",
    description: editing?.description ?? "",
    periodId: editing?.periodId ?? viewed?.periodId ?? periods[0]?.id ?? "",
    week: editing?.week ?? viewed?.week ?? 1,
    weekday: editing?.weekday ?? 4,
    milestoneId: editing?.milestoneId ?? "",
    assigneeIds: editing?.assigneeIds ?? [],
    status: editing?.status ?? "Backlog",
    ...seed,
  }));
  const patch = (next: Partial<TaskDraft>) => setDraft((d) => ({ ...d, ...next }));
  const due: DueRef = { periodId: draft.periodId, week: draft.week, weekday: draft.weekday };

  const save = () => {
    const status = editing ? draft.status : (seed?.status ?? createStatus(draft, viewed));
    submit(
      {
        intent: "task-save",
        ...(editing ? { id: editing.id } : {}),
        title: draft.title,
        description: draft.description,
        periodId: draft.periodId,
        week: String(draft.week),
        weekday: String(draft.weekday),
        milestoneId: draft.milestoneId,
        assigneeIds: draft.assigneeIds.join(","),
        status,
      },
      () => null,
    );
  };

  const remove = async () => {
    if (!editing) return;
    const ok = await dialog.confirm({
      title: "Delete this task?",
      description: "It can't be undone.",
      confirmLabel: "Delete task",
      tone: "destructive",
    });
    if (ok) submit({ intent: "task-delete", id: editing.id });
  };

  const current = STATUS_CHIPS.find((s) => s.value === draft.status);

  return (
    <PanelFrame width={620} labelledBy={titleId} onClose={onClose}>
      <div className="mb-5 flex items-center justify-between gap-3">
        {editing ? (
          <div className="flex items-center gap-3">
            <span id={titleId} className="text-xs font-bold uppercase tracking-wide text-os-grey">
              Edit task
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-os-card px-2.5 py-1 text-xs font-semibold text-os-fg">
              <span className={cn("h-2 w-2 rounded-full", current?.dot)} aria-hidden />
              {current?.label}
            </span>
          </div>
        ) : (
          <>
            <span id={titleId} className="sr-only">
              New task
            </span>
            <PanelTabs active="task" openDialog={openDialog} />
          </>
        )}
        <button type="button" onClick={onClose} aria-label="Close" className="os-icon-btn">
          <X className="h-5 w-5" aria-hidden />
        </button>
      </div>
      <form
        className="os-form"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <input
          type="text"
          aria-label="Title"
          placeholder="Task"
          value={draft.title}
          maxLength={200}
          autoFocus
          onChange={(e) => patch({ title: e.target.value })}
          className="mb-5 w-full !rounded-none !border-0 !border-b !border-os-container !bg-transparent !px-0 pb-3 !shadow-none text-[26px] font-medium leading-8 outline-none placeholder:text-os-muted"
        />
        <div className="flex flex-col gap-4">
          <Row icon={<AlignLeft className="h-5 w-5" aria-hidden />} label="Description">
            <textarea
              aria-label="Description"
              placeholder="Add description"
              rows={3}
              value={draft.description}
              onChange={(e) => patch({ description: e.target.value })}
              className="w-full"
            />
          </Row>
          <Row icon={<Diamond className="h-5 w-5 fill-current text-os-milestone" aria-hidden />} label="Milestone">
            <MilestonePicker
              value={draft.milestoneId}
              milestones={milestones}
              periods={periods}
              duePeriodId={draft.periodId}
              onChange={(id) => patch({ milestoneId: id })}
              onCreate={(name) =>
                openDialog({
                  kind: "milestone",
                  milestoneId: null,
                  periodId: draft.periodId,
                  name,
                  returnToTask: { taskId: editing?.id ?? null, draft },
                })
              }
            />
          </Row>
          <Row icon={<CalendarDays className="h-5 w-5" aria-hidden />} label="Due">
            <DueDatePicker
              value={due}
              periods={periods}
              tasks={tasks}
              members={members}
              excludeTaskId={editing?.id ?? null}
              todayYmd={today}
              onChange={(ref) => patch({ periodId: ref.periodId, week: ref.week, weekday: ref.weekday })}
            />
          </Row>
          <Row icon={<Users className="h-5 w-5" aria-hidden />} label="Who">
            <AssigneePicker value={draft.assigneeIds} members={members} meId={userId} onChange={(ids) => patch({ assigneeIds: ids })} />
          </Row>
          {editing && (
            <Row icon={<Flag className="h-5 w-5" aria-hidden />} label="Status">
              <div className="flex flex-wrap gap-2" role="group" aria-label="Status">
                {STATUS_CHIPS.map((s) => (
                  <button
                    key={s.value}
                    type="button"
                    aria-pressed={draft.status === s.value}
                    onClick={() => patch({ status: s.value })}
                    className={cn(
                      "inline-flex h-9 items-center gap-2 rounded-full border px-3.5 text-sm font-semibold",
                      draft.status === s.value ? "border-os-accent bg-os-accent-tint text-os-fg" : "border-os-container text-os-grey hover:bg-os-hover",
                    )}
                  >
                    <span className={cn("h-2 w-2 rounded-full", s.dot)} aria-hidden />
                    {s.label}
                  </button>
                ))}
              </div>
            </Row>
          )}
        </div>
        <ModalFooter onCancel={onClose} cancelDisabled={busy}>
          {editing && (
            <Button variant="destructive" onClick={remove} disabled={busy} className="mr-auto">
              Delete
            </Button>
          )}
          <Button type="submit" disabled={busy || draft.title.trim() === ""}>
            {editing ? "Save changes" : "Create task"}
          </Button>
        </ModalFooter>
      </form>
    </PanelFrame>
  );
}
