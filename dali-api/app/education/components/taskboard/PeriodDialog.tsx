import { useId, useMemo, useState } from "react";
import { PanelFrame } from "./PanelFrame";
import { Button } from "~/components/ui/Button";
import { DateField } from "~/components/ui/DateField";
import { useDialog } from "~/components/ui/dialog";
import { Segmented } from "~/components/ui/Segmented";
import { cn } from "~/lib/cn";
import {
  endFromLength,
  lengthFromEnd,
  periodSummary,
  suggestPeriodName,
  suggestShortName,
} from "~/education/lib/taskboard/period-defaults";
import { sortPeriods, sundayOnOrBefore, type PeriodKind } from "~/education/lib/taskboard/weeks";
import { PanelTabs } from "./PanelTabs";
import { TermLengthStepper } from "./TermLengthStepper";
import type { Dialog, Submit, TaskboardData } from "./types";

const FALLBACK_WEEKS: Record<Exclude<PeriodKind, "Term">, number> = { Interim: 2, Custom: 3 };

export function PeriodDialog({
  data,
  periodId,
  submit,
  onClose,
  openDialog,
  busy,
}: {
  data: TaskboardData;
  periodId: string | null;
  submit: Submit;
  onClose: () => void;
  openDialog: (d: Dialog) => void;
  busy: boolean;
}) {
  const titleId = useId();
  const dialog = useDialog();
  const editing = periodId ? (data.periods.find((p) => p.id === periodId) ?? null) : null;

  const [kind, setKind] = useState<PeriodKind>(editing?.kind ?? "Term");
  const [name, setName] = useState(editing?.name ?? "");
  const [nameTouched, setNameTouched] = useState(editing !== null);
  const [startDate, setStartDate] = useState(editing?.startDate ?? "");
  const [defaultWeeks, setDefaultWeeks] = useState(data.termWeeks);
  const [termLen, setTermLen] = useState(editing?.kind === "Term" ? editing.weekCount : data.termWeeks);
  const [termLenTouched, setTermLenTouched] = useState(editing !== null);
  const [endDate, setEndDate] = useState(
    editing && editing.kind !== "Term" ? endFromLength(editing.startDate, editing.weekCount) : "",
  );

  const snapped = startDate ? sundayOnOrBefore(startDate) : "";
  const shownName = nameTouched ? name : suggestPeriodName(kind, snapped);
  const flexWeeks = snapped && endDate ? lengthFromEnd(snapped, endDate) : FALLBACK_WEEKS[kind === "Term" ? "Custom" : kind];
  const weeks = kind === "Term" ? termLen : flexWeeks;

  const strip = useMemo(() => {
    const others = data.periods.filter((p) => p.id !== editing?.id).map((p) => ({ ...p, isNew: false }));
    const fresh = {
      id: "new",
      name: shownName,
      shortName: suggestShortName(kind, shownName, snapped),
      kind,
      startDate: snapped || "9999-12-31",
      weekCount: weeks,
      isNew: true,
    };
    return sortPeriods([...others, fresh]);
  }, [data.periods, editing?.id, shownName, kind, snapped, weeks]);

  const saveDefault = (n: number) => {
    setDefaultWeeks(n);
    if (!termLenTouched) setTermLen(n);
    submit({ intent: "settings-save", termWeeks: String(n) }, () => ({ kind: "period", periodId }));
  };

  const pickStart = (value: string) => {
    setStartDate(value);
    if (kind !== "Term" && value && !endDate) setEndDate(endFromLength(sundayOnOrBefore(value), FALLBACK_WEEKS[kind]));
  };

  const save = () =>
    submit(
      {
        intent: "period-save",
        ...(editing ? { id: editing.id } : {}),
        name: shownName,
        shortName: editing?.shortName ?? suggestShortName(kind, shownName, snapped),
        kind,
        startDate: snapped,
        weekCount: String(weeks),
      },
      () => null,
    );

  const remove = async () => {
    if (!editing) return;
    const ok = await dialog.confirm({
      title: "Delete this period?",
      description: "Its milestones are deleted too. Periods with tasks can't be deleted.",
      confirmLabel: "Delete period",
      tone: "destructive",
    });
    if (ok) submit({ intent: "period-delete", id: editing.id });
  };

  return (
    <PanelFrame width={1120} labelledBy={titleId} onClose={onClose}>
      <span id={titleId} className="sr-only">
        {editing ? "Edit term or period" : "New term or period"}
      </span>
      <form
        className="os-form grid gap-6 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <section className="flex min-w-0 flex-col gap-4 rounded-os-card bg-os-card p-5">
          <h2 className="text-lg font-semibold text-os-fg">Where it lands in the year</h2>
          <div className="flex min-h-[150px] gap-1.5 overflow-x-auto rounded-os-item bg-os-bg p-3" aria-label="Year preview">
            {strip.map((p) => (
              <div
                key={p.id}
                style={{ flexGrow: p.weekCount, flexBasis: `${p.weekCount * 14}px` }}
                className={cn(
                  "flex min-w-[56px] flex-col justify-end rounded-os-item p-3",
                  p.isNew
                    ? "border-2 border-dashed border-os-accent bg-(--tb-accent-tint)"
                    : p.kind === "Term"
                      ? "bg-os-card"
                      : "border border-dashed border-os-container-hi bg-os-well",
                )}
              >
                <span className="truncate text-sm font-bold text-os-fg">{p.shortName}</span>
                <span className="text-xs text-os-grey">{p.weekCount} wks</span>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-os-item bg-os-bg px-4 py-3">
            <div>
              <p className="text-sm font-semibold text-os-fg">Default term length</p>
              <p className="text-xs text-os-grey">Used for every new term</p>
            </div>
            <TermLengthStepper value={defaultWeeks} onChange={saveDefault} disabled={busy} />
          </div>
        </section>

        <section className="flex min-w-0 flex-col gap-4">
          <div className="flex items-center justify-between gap-3">
            {editing ? (
              <span className="text-xs font-bold uppercase tracking-wide text-os-grey">Edit term or period</span>
            ) : (
              <PanelTabs active="period" openDialog={openDialog} />
            )}
            <button type="button" onClick={onClose} aria-label="Close" className="os-icon-btn">
              ×
            </button>
          </div>
          <Segmented<PeriodKind>
            ariaLabel="Type"
            pill
            size="md"
            value={kind}
            onChange={(next) => {
              setKind(next);
              if (next !== "Term" && snapped && !endDate) setEndDate(endFromLength(snapped, FALLBACK_WEEKS[next]));
            }}
            options={[
              { value: "Term", label: "Term" },
              { value: "Interim", label: "Interim" },
              { value: "Custom", label: "Custom" },
            ]}
          />
          <input
            type="text"
            aria-label="Name"
            placeholder="Name"
            value={shownName}
            maxLength={60}
            autoFocus
            onChange={(e) => {
              setName(e.target.value);
              setNameTouched(true);
            }}
            className="w-full !border-0 !bg-transparent !px-0 !shadow-none text-[26px] font-medium leading-8 outline-none placeholder:text-os-muted"
          />
          <label className="os-field-group">
            <span className="os-field-label">Starts</span>
            <DateField mode="date" value={startDate} onChange={pickStart} />
            <span className="os-field-hint">Moves to the Sunday on or before the date you pick.</span>
          </label>
          {kind === "Term" ? (
            <div className="os-field-group">
              <span className="os-field-label">Length</span>
              <TermLengthStepper
                value={termLen}
                onChange={(n) => {
                  setTermLen(n);
                  setTermLenTouched(true);
                }}
              />
            </div>
          ) : (
            <label className="os-field-group">
              <span className="os-field-label">Ends</span>
              <DateField mode="date" value={endDate} onChange={setEndDate} />
            </label>
          )}
          <p className="rounded-os-item bg-os-card px-4 py-3 text-sm text-os-grey">
            {periodSummary(kind, weeks, kind === "Term" && weeks === defaultWeeks)}
          </p>
          <div className="mt-auto flex items-center justify-end gap-2">
            {editing && (
              <Button variant="destructive" onClick={remove} disabled={busy} className="mr-auto">
                Delete
              </Button>
            )}
            <Button variant="ghost" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || shownName.trim() === "" || snapped === ""}>
              {editing ? "Save changes" : "Create"}
            </Button>
          </div>
        </section>
      </form>
    </PanelFrame>
  );
}
