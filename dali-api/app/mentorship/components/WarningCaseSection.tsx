import { useEffect, useId, useRef, useState } from "react";
import { useFetcher } from "react-router";
import { ChevronDown } from "lucide-react";
import { DateField } from "~/components/ui/DateField";
import { Combobox, Select } from "~/components/ui/floating";
import { useToast } from "~/components/ui/toast";
import { cn } from "~/lib/cn";
import type { MemberWarningCase } from "../lib/warnings.server";
import { WARNING_STAGES, reasonLabel, stageLabel, type WarningCaseInput, type WarningStage } from "../lib/warnings";

type Person = { id: string; name: string };
type ActionResult = { ok: true; message: string } | { ok: false; error: string };
type CaseFields = Pick<
  WarningCaseInput,
  "investigatorId" | "willAcceptReapp" | "stage" | "meeting1On" | "meeting1Notes" | "meeting2On" | "meeting2Notes"
>;

const REAPP_OPTIONS = [
  { value: "", label: "Not decided" },
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
];

const STAGE_TONE: Record<string, string> = {
  pending: "bg-os-container text-os-grey",
  pre_meeting_1: "bg-os-amber/15 text-os-amber",
  pre_meeting_2: "bg-os-amber/15 text-os-amber",
  ok_to_reapp: "bg-os-green/15 text-os-green",
  dropped: "bg-destructive/10 text-destructive",
};

const SELECT_BUTTON =
  "w-full text-sm px-2.5 py-1.5 border border-os-container rounded-os-item bg-transparent text-foreground inline-flex items-center justify-between gap-1 transition-colors hover:border-os-container-hi focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-os-accent/40";

const formatDate = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

export function WarningCaseSection({ warnings, people }: { warnings: MemberWarningCase[]; people: Person[] }) {
  if (warnings.length === 0) return null;
  return (
    <section aria-label="Warnings" className="flex flex-col gap-3">
      <h2 className="text-[15px] font-bold text-foreground">Warnings</h2>
      {warnings.map((w) => (
        <WarningCaseCard key={w.id} warning={w} people={people} />
      ))}
    </section>
  );
}

function StatusBadge({ stage }: { stage: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold",
        STAGE_TONE[stage] ?? STAGE_TONE.pending,
      )}
    >
      {stageLabel(stage)}
    </span>
  );
}

function WarningCaseCard({ warning, people }: { warning: MemberWarningCase; people: Person[] }) {
  const fetcher = useFetcher<ActionResult>();
  const toast = useToast();
  const handled = useRef<unknown>(null);
  const saved: CaseFields = {
    investigatorId: warning.investigatorId,
    willAcceptReapp: warning.willAcceptReapp,
    stage: warning.stage as WarningStage,
    meeting1On: warning.meeting1On,
    meeting1Notes: warning.meeting1Notes,
    meeting2On: warning.meeting2On,
    meeting2Notes: warning.meeting2Notes,
  };
  const [draft, setDraft] = useState<CaseFields>(saved);
  const busy = fetcher.state !== "idle";

  useEffect(() => {
    const d = fetcher.data;
    if (!d || handled.current === d) return;
    handled.current = d;
    if (d.ok) toast.success(d.message);
    else {
      toast.error(d.error);
      setDraft(saved);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.data, toast]);

  const post = (fields: Record<string, string>) =>
    fetcher.submit({ id: warning.id, ...fields }, { method: "post", action: "/mentorship/warnings" });

  const save = (patch: Partial<CaseFields>) => {
    setDraft((d) => ({ ...d, ...patch }));
    post({ intent: "case", ...patch });
  };

  const resolved = warning.status === "resolved";
  const meta = [formatDate(warning.occurredOn), warning.termCode, warning.submittedBy ? `Submitted by ${warning.submittedBy}` : null]
    .filter(Boolean)
    .join(" · ");

  return (
    <article className="flex flex-col rounded-os-card border border-os-container px-4 py-3">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h3 className="text-sm font-semibold text-foreground">{reasonLabel(warning.reason)}</h3>
        <StatusBadge stage={draft.stage} />
        {resolved && (
          <span className="inline-flex items-center rounded-full border border-os-container px-2.5 py-0.5 text-[11px] font-semibold text-os-grey">
            Resolved
          </span>
        )}
        <button
          type="button"
          className="ml-auto text-xs font-semibold text-os-grey underline-offset-2 hover:text-foreground hover:underline disabled:opacity-50"
          disabled={busy}
          onClick={() => post({ intent: "status", status: resolved ? "open" : "resolved" })}
        >
          {resolved ? "Reopen" : "Mark resolved"}
        </button>
      </header>
      <p className="mt-0.5 text-xs text-os-grey">{meta}</p>
      <p className={cn("mt-2 whitespace-pre-wrap text-sm", warning.notes ? "text-foreground" : "italic text-os-muted")}>
        {warning.notes || "No reason given."}
      </p>

      <div className="mt-3 grid grid-cols-1 gap-3 border-t border-os-container pt-3 sm:grid-cols-3">
        <LabeledField label="Investigator">
          <Combobox
            value={draft.investigatorId}
            options={people.map((p) => ({ value: p.id, label: p.name }))}
            onChange={(v) => save({ investigatorId: v })}
            ariaLabel="Investigator"
            placeholder="Unassigned"
            emptyLabel="No members found"
            className="w-full !bg-transparent border border-os-container !rounded-os-item px-2.5 py-1.5 hover:border-os-container-hi"
          />
        </LabeledField>
        <LabeledField label="Status">
          <Select
            value={draft.stage}
            options={WARNING_STAGES.map((s) => ({ value: s.value, label: s.label }))}
            onChange={(v) => save({ stage: v as WarningStage })}
            ariaLabel="Status"
            buttonClassName={SELECT_BUTTON}
          />
        </LabeledField>
        <LabeledField label="Can reapply">
          <Select
            value={draft.willAcceptReapp}
            options={REAPP_OPTIONS}
            onChange={(v) => save({ willAcceptReapp: v as CaseFields["willAcceptReapp"] })}
            ariaLabel="Can reapply"
            buttonClassName={SELECT_BUTTON}
          />
        </LabeledField>
      </div>

      <div className="mt-3 border-t border-os-container pt-2">
        <h4 className="text-[11px] font-semibold uppercase tracking-widest text-os-grey">Follow-up meetings</h4>
        <ul className="mt-1 flex flex-col">
          <MeetingRow
            n={1}
            date={draft.meeting1On}
            notes={draft.meeting1Notes}
            savedDate={saved.meeting1On}
            savedNotes={saved.meeting1Notes}
            busy={busy}
            onSave={(date, notes) => save({ meeting1On: date, meeting1Notes: notes })}
          />
          <MeetingRow
            n={2}
            date={draft.meeting2On}
            notes={draft.meeting2Notes}
            savedDate={saved.meeting2On}
            savedNotes={saved.meeting2Notes}
            busy={busy}
            onSave={(date, notes) => save({ meeting2On: date, meeting2Notes: notes })}
          />
        </ul>
      </div>
    </article>
  );
}

function LabeledField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-xs text-os-grey">{label}</span>
      {children}
    </div>
  );
}

function MeetingRow({
  n,
  date,
  notes,
  savedDate,
  savedNotes,
  busy,
  onSave,
}: {
  n: 1 | 2;
  date: string;
  notes: string;
  savedDate: string;
  savedNotes: string;
  busy: boolean;
  onSave: (date: string, notes: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [localDate, setLocalDate] = useState(date);
  const [localNotes, setLocalNotes] = useState(notes);
  const area = useRef<HTMLTextAreaElement>(null);
  const dirty = localDate !== savedDate || localNotes !== savedNotes;
  const id = `${useId()}-meeting-${n}`;

  useEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [localNotes, open]);

  return (
    <li className="border-t border-os-container first:border-t-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={id}
        className="flex w-full items-center gap-3 rounded-os-item py-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-os-accent/40"
      >
        <span className="text-sm font-medium text-foreground">Meeting {n}</span>
        <span className={cn("text-xs", savedDate ? "text-foreground" : "text-os-grey")}>
          {savedDate ? formatDate(savedDate) : "Not scheduled"}
          {savedNotes ? " · Notes added" : ""}
        </span>
        <ChevronDown className={cn("ml-auto h-4 w-4 text-os-grey transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      {open && (
        <div id={id} className="grid grid-cols-1 gap-3 pb-3 sm:grid-cols-[13rem_1fr]">
          <div className="flex flex-col gap-1">
            <span className="text-xs text-os-grey">Date</span>
            <DateField mode="date" value={localDate} onChange={setLocalDate} ariaLabel={`Meeting ${n} date`} />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor={`${id}-notes`} className="text-xs text-os-grey">
              Notes
            </label>
            <textarea
              id={`${id}-notes`}
              ref={area}
              rows={3}
              value={localNotes}
              onChange={(e) => setLocalNotes(e.target.value)}
              placeholder="What was discussed?"
              className="min-h-[5rem] w-full resize-none overflow-hidden rounded-os-item border border-os-container bg-transparent px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-os-accent/40"
            />
          </div>
          {dirty && (
            <div className="flex justify-end gap-2 sm:col-span-2">
              <button
                type="button"
                className="text-[12px] font-semibold text-os-grey hover:text-foreground"
                onClick={() => {
                  setLocalDate(savedDate);
                  setLocalNotes(savedNotes);
                }}
              >
                Discard
              </button>
              <button
                type="button"
                className="os-btn-primary os-btn-primary--sm"
                disabled={busy}
                onClick={() => onSave(localDate, localNotes)}
              >
                {busy ? "Saving…" : "Save"}
              </button>
            </div>
          )}
        </div>
      )}
    </li>
  );
}
