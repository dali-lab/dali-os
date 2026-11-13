import { useEffect, useRef, useState } from "react";
import { LOOSE_GROUP_KEY } from "~/education/lib/taskboard/backlog-groups";
import { useFetcher, useSearchParams } from "react-router";
import { Plus, Settings } from "lucide-react";
import { Button } from "~/components/ui/Button";
import { Select } from "~/components/ui/floating/Select";
import { Segmented } from "~/components/ui/Segmented";
import { useToast } from "~/components/ui/toast";
import { dateRange } from "~/education/lib/taskboard/labels";
import { periodEnd, type WeekRef } from "~/education/lib/taskboard/weeks";
import { MilestoneDetail } from "./MilestoneDetail";
import { MilestoneDialog } from "./MilestoneDialog";
import { PeriodDialog } from "./PeriodDialog";
import { TaskDialog } from "./TaskDialog";
import { TermLengthStepper } from "./TermLengthStepper";
import { TermView } from "./TermView";
import { WeekView } from "./WeekView";
import { YearView } from "./YearView";
import type { Dialog, Submit, SubmitResult, TaskboardData, Zoom } from "./types";
import "./taskboard.css";

const ZOOMS: Zoom[] = ["year", "term", "week"];

function parseZoom(v: string | null): Zoom {
  return ZOOMS.includes(v as Zoom) ? (v as Zoom) : "week";
}

export function TaskboardPage(data: TaskboardData) {
  const [params, setParams] = useSearchParams();
  const fetcher = useFetcher<{ ok?: boolean; error?: string }>();
  const toast = useToast();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [lengthOpen, setLengthOpen] = useState(false);
  const [everyone, setEveryone] = useState(true);
  const zoom = parseZoom(params.get("zoom"));
  const busy = fetcher.state !== "idle";
  const navigate = (next: { zoom?: Zoom; ref?: WeekRef | null }) => {
    const p = new URLSearchParams(params);
    if (next.zoom) p.set("zoom", next.zoom);
    if (next.ref === null) {
      p.delete("period");
      p.delete("week");
    } else if (next.ref) {
      p.set("period", next.ref.periodId);
      p.set("week", String(next.ref.week));
    }
    setParams(p, { preventScrollReset: true });
  };

  const handled = useRef<unknown>(null);
  const afterRef = useRef<Parameters<Submit>[1]>(undefined);
  const createdTask = useRef<string | null>(null);
  const [reveal, setReveal] = useState<{ key: string; nonce: number } | null>(null);

  useEffect(() => {
    if (!fetcher.data || handled.current === fetcher.data) return;
    handled.current = fetcher.data;
    if (fetcher.data.error) {
      toast.error(fetcher.data.error);
      return;
    }
    const next = afterRef.current?.(fetcher.data as SubmitResult) ?? null;
    afterRef.current = undefined;
    setDialog(next);
    if (createdTask.current !== null) {
      setReveal({ key: createdTask.current || LOOSE_GROUP_KEY, nonce: Date.now() });
      createdTask.current = null;
      navigate({ zoom: "week" });
    }
  }, [fetcher.data, toast]);

  const submit: Submit = (fields, after) => {
    afterRef.current = after;
    createdTask.current = fields.intent === "task-save" && !fields.id ? (fields.milestoneId ?? "") : null;
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) form.set(k, v);
    fetcher.submit(form, { method: "post" });
  };

  const { periods, current, viewed } = data;
  const onCurrentWeek = viewed && current && viewed.periodId === current.periodId && viewed.week === current.week;
  const viewedPeriod = periods.find((p) => p.id === viewed?.periodId);

  const heading =
    zoom === "year" ? "Year" : viewedPeriod ? `${viewedPeriod.name}` : "";

  return (
    <div className="flex flex-col gap-5 px-7 pb-8 pt-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3.5">
          <Segmented<Zoom>
            ariaLabel="Zoom"
            pill
            size="md"
            value={zoom}
            onChange={(z) => navigate({ zoom: z })}
            options={[
              { value: "year", label: "Year" },
              { value: "term", label: "Term" },
              { value: "week", label: "Week" },
            ]}
          />
          {zoom === "week" && viewedPeriod && (
            <Select
              ariaLabel="Term"
              value={viewedPeriod.id}
              onChange={(id) => navigate({ ref: { periodId: id, week: current?.periodId === id ? current.week : 1 } })}
              options={periods.map((p) => ({
                value: p.id,
                label: p.name,
                description: dateRange(p.startDate, periodEnd(p)),
              }))}
            />
          )}
          {zoom !== "week" && <span className="text-xl font-semibold text-os-fg">{heading}</span>}
          {zoom === "year" && (
            <Button variant="secondary" size="sm" aria-expanded={lengthOpen} onClick={() => setLengthOpen((v) => !v)}>
              <Settings className="h-3.5 w-3.5" aria-hidden />
              Term length: {data.termWeeks} weeks
            </Button>
          )}
          {zoom === "week" && !onCurrentWeek && current && (
            <Button variant="secondary" size="sm" onClick={() => navigate({ ref: null })}>
              Today
            </Button>
          )}
        </div>
        <Button onClick={() => setDialog({ kind: "task", taskId: null })}>
          <Plus className="h-4 w-4" aria-hidden />
          Add
        </Button>
      </div>

      {zoom === "year" && lengthOpen && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-os-card bg-os-card px-5 py-3">
          <div>
            <p className="text-sm font-semibold text-os-fg">Default term length</p>
            <p className="text-xs text-os-grey">Used for every new term</p>
          </div>
          <TermLengthStepper
            value={data.termWeeks}
            disabled={busy}
            onChange={(n) => submit({ intent: "settings-save", termWeeks: String(n) }, () => null)}
          />
        </div>
      )}
      {zoom === "year" && (
        <YearView
          data={data}
          openDialog={setDialog}
          openPeriod={(ref) => navigate({ zoom: "term", ref })}
        />
      )}
      {zoom === "term" && (
        <TermView data={data} openDialog={setDialog} openWeek={(ref) => navigate({ zoom: "week", ref })} />
      )}
      {zoom === "week" && (
        <WeekView
          data={data}
          reveal={reveal}
          everyone={everyone}
          onEveryoneChange={setEveryone}
          openDialog={setDialog}
          goTo={(ref) => navigate({ ref })}
          submit={submit}
        />
      )}

      {dialog?.kind === "task" && (
        <TaskDialog
          key={`${dialog.taskId ?? "new"}-${dialog.draft?.milestoneId ?? ""}`}
          data={data}
          taskId={dialog.taskId}
          draft={dialog.draft}
          submit={submit}
          onClose={() => setDialog(null)}
          openDialog={setDialog}
          busy={busy}
        />
      )}
      {dialog?.kind === "milestone" && (
        <MilestoneDialog
          key={dialog.milestoneId ?? "new"}
          data={data}
          milestoneId={dialog.milestoneId}
          periodId={dialog.periodId}
          name={dialog.name}
          returnToTask={dialog.returnToTask}
          submit={submit}
          onClose={() => setDialog(null)}
          openDialog={setDialog}
          busy={busy}
        />
      )}
      {dialog?.kind === "milestone-detail" && (
        <MilestoneDetail data={data} milestoneId={dialog.milestoneId} onClose={() => setDialog(null)} openDialog={setDialog} />
      )}
      {dialog?.kind === "period" && (
        <PeriodDialog
          key={dialog.periodId ?? "new"}
          data={data}
          periodId={dialog.periodId}
          submit={submit}
          onClose={() => setDialog(null)}
          openDialog={setDialog}
          busy={busy}
        />
      )}
    </div>
  );
}
