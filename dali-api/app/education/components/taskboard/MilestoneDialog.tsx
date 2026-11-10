import { useId, useState } from "react";
import { PanelFrame } from "./PanelFrame";
import { Button } from "~/components/ui/Button";
import { useDialog } from "~/components/ui/dialog";
import { Select } from "~/components/ui/floating/Select";
import { cn } from "~/lib/cn";
import { shortDate } from "~/education/lib/taskboard/labels";
import { defaultSpan, pickWeek, spanLabel, type WeekPick } from "~/education/lib/taskboard/week-pick";
import { addDays, weekStart } from "~/education/lib/taskboard/weeks";
import { PanelTabs } from "./PanelTabs";
import type { Dialog, Submit, TaskboardData } from "./types";

export function MilestoneDialog({
  data,
  milestoneId,
  periodId: initialPeriodId,
  name: initialName,
  returnToTask,
  submit,
  onClose,
  openDialog,
  busy,
}: {
  data: TaskboardData;
  milestoneId: string | null;
  periodId?: string;
  name?: string;
  returnToTask?: Extract<NonNullable<Dialog>, { kind: "milestone" }>["returnToTask"];
  submit: Submit;
  onClose: () => void;
  openDialog: (d: Dialog) => void;
  busy: boolean;
}) {
  const { periods, milestones, viewed } = data;
  const titleId = useId();
  const dialog = useDialog();
  const editing = milestoneId ? (milestones.find((m) => m.id === milestoneId) ?? null) : null;

  const startPeriodId = editing?.periodId ?? initialPeriodId ?? viewed?.periodId ?? periods[0]?.id ?? "";
  const [periodId, setPeriodId] = useState(startPeriodId);
  const period = periods.find((p) => p.id === periodId);
  const weekCount = period?.weekCount ?? 1;

  const [name, setName] = useState(editing?.name ?? initialName ?? "");
  const [description, setDescription] = useState(editing?.description ?? "");
  const [pick, setPick] = useState<WeekPick>(() => {
    if (editing) return { start: editing.startWeek, end: editing.endWeek, next: "start" };
    const anchor = returnToTask ? returnToTask.draft.week : viewed && viewed.periodId === startPeriodId ? viewed.week : null;
    const span = defaultSpan(periods.find((p) => p.id === startPeriodId)?.weekCount ?? 1, anchor);
    return { ...span, next: "start" };
  });

  const siblings = milestones.filter((m) => m.periodId === periodId && m.id !== editing?.id);
  const weeks = Array.from({ length: weekCount }, (_, i) => i + 1);

  const after: Parameters<Submit>[1] = (result) => {
    if (returnToTask) {
      return {
        kind: "task",
        taskId: returnToTask.taskId,
        draft: { ...returnToTask.draft, milestoneId: result.id ?? returnToTask.draft.milestoneId },
      };
    }
    return result.id ? { kind: "milestone-detail", milestoneId: result.id } : null;
  };

  const save = () =>
    submit(
      {
        intent: "milestone-save",
        ...(editing ? { id: editing.id } : {}),
        name,
        description,
        periodId,
        startWeek: String(pick.start),
        endWeek: String(pick.end),
      },
      after,
    );

  const remove = async () => {
    if (!editing) return;
    const ok = await dialog.confirm({
      title: "Delete this milestone?",
      description: "Its tasks stay on the board as loose tasks.",
      confirmLabel: "Delete milestone",
      tone: "destructive",
    });
    if (ok) submit({ intent: "milestone-delete", id: editing.id });
  };

  return (
    <PanelFrame width={1120} labelledBy={titleId} onClose={onClose}>
      <span id={titleId} className="sr-only">
        {editing ? "Edit milestone" : "New milestone"}
      </span>
      <form
        className="os-form grid gap-6 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <section className="flex min-w-0 flex-col gap-4 rounded-os-card bg-os-card p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-os-fg">Pick the weeks it runs</h2>
            <Select
              ariaLabel="Term or period"
              value={periodId}
              onChange={(id) => {
                setPeriodId(id);
                const count = periods.find((p) => p.id === id)?.weekCount ?? 1;
                setPick({ ...defaultSpan(count, null), next: "start" });
              }}
              options={periods.map((p) => ({ value: p.id, label: p.name }))}
            />
          </div>
          <div className="overflow-x-auto rounded-os-item bg-os-bg p-3">
            <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${weekCount}, minmax(44px, 1fr))` }}>
              {weeks.map((w) => {
                const inSpan = w >= pick.start && w <= pick.end;
                return (
                  <button
                    key={w}
                    type="button"
                    aria-pressed={inSpan}
                    aria-label={`Week ${w}`}
                    onClick={() => setPick((s) => pickWeek(s, w))}
                    className={cn(
                      "flex h-14 flex-col items-center justify-center rounded-os-item border text-sm",
                      inSpan ? "border-(--tb-milestone) bg-(--tb-milestone-tint)" : "border-os-container hover:bg-os-hover",
                    )}
                  >
                    <span className="font-bold text-os-fg">{w}</span>
                    <span className="text-[11px] text-os-grey">{period ? shortDate(addDays(weekStart(period, w), 1)) : ""}</span>
                  </button>
                );
              })}
              {siblings.map((m) => (
                <div
                  key={m.id}
                  title={m.name}
                  style={{ gridColumn: `${m.startWeek} / span ${m.endWeek - m.startWeek + 1}` }}
                  className="mt-1 h-[26px] truncate rounded-full bg-(--tb-milestone-tint) px-3 text-xs font-semibold leading-[26px] text-(--tb-milestone)"
                >
                  {m.name}
                </div>
              ))}
            </div>
          </div>
          <p className="text-xs text-os-grey">
            Click a start week, then an end week. Existing milestones show underneath so you can see what overlaps.
          </p>
        </section>

        <section className="flex min-w-0 flex-col gap-4">
          <div className="flex items-center justify-between gap-3">
            {editing ? (
              <span className="text-xs font-bold uppercase tracking-wide text-os-grey">Edit milestone</span>
            ) : (
              <PanelTabs active="milestone" openDialog={openDialog} />
            )}
            <button type="button" onClick={onClose} aria-label="Close" className="os-icon-btn">
              ×
            </button>
          </div>
          <input
            type="text"
            aria-label="Name"
            placeholder="Milestone"
            value={name}
            maxLength={120}
            autoFocus
            onChange={(e) => setName(e.target.value)}
            className="w-full !border-0 !bg-transparent !px-0 !shadow-none text-[26px] font-medium leading-8 outline-none placeholder:text-os-muted"
          />
          <div className="flex items-center gap-3">
            <span className="rounded-full border border-os-accent px-3 py-1 text-sm font-semibold text-os-fg">
              {period?.shortName} · Week {pick.start} to {pick.end}
            </span>
            <span className="text-sm text-os-grey">{spanLabel(pick.start, pick.end)}</span>
          </div>
          <textarea
            aria-label="Description"
            placeholder="Add description"
            rows={4}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full"
          />
          {returnToTask && (
            <p className="rounded-os-item bg-(--tb-milestone-tint) px-4 py-3 text-sm text-os-fg">
              Creating this from your task. After you save, you go back to the task with this milestone picked.{" "}
              <button
                type="button"
                className="font-bold text-(--tb-milestone) underline"
                onClick={() => openDialog({ kind: "task", taskId: returnToTask.taskId, draft: returnToTask.draft })}
              >
                Back to task
              </button>
            </p>
          )}
          {!editing && (
            <p className="text-sm text-os-grey">
              Next, add tasks to it. Each task lands in the week of its due date and shows nested under this milestone in the backlog.
            </p>
          )}
          <div className="mt-auto flex items-center justify-end gap-2">
            {editing && (
              <Button variant="destructive" onClick={remove} disabled={busy} className="mr-auto">
                Delete
              </Button>
            )}
            <Button variant="ghost" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || name.trim() === ""}>
              {editing ? "Save changes" : "Create milestone"}
            </Button>
          </div>
        </section>
      </form>
    </PanelFrame>
  );
}
