import { useRevalidator } from "react-router";
import { useEffect, useState } from "react";
import { X } from "lucide-react";
import type { RoleInstance } from "~/lib/roles";
import { Modal, ModalHeader } from "~/components/Modal";
import { DateField } from "~/components/ui/DateField";
import { Select } from "~/components/ui/floating";
import { useOsChrome } from "~/components/os-chrome";
import { cn } from "~/lib/cn";
import type { TimeEntryDTO } from "~/calendar/lib/types";
import { roleOptionKey, parseRoleOptionKey } from "~/calendar/components/role-fields";

// Shown wherever time can be logged but the user holds no paid role. Every
// entry must attribute to one, so there's nothing valid to submit.
const NO_ROLES_MESSAGE =
  "You have no paid roles this term, so there's nothing to log hours against.";


// The new-entry form. Both surfaces that create an entry wear it: the grid's
// slot popover (dragged out on the week grid) and the centered Log hours
// dialog (the toolbar button, which has no slot to anchor to).
function TimesheetEntryForm({
  startLocal,
  endLocal,
  myRoles,
  onClose,
  compact = false,
  idPrefix,
}: {
  startLocal: string;
  endLocal: string;
  myRoles: RoleInstance[];
  onClose: () => void;
  /** The popover's tighter metrics. The dialog's own card supplies padding. */
  compact?: boolean;
  idPrefix: string;
}) {
  const { formClass, formTrigger } = useOsChrome();
  const revalidator = useRevalidator();
  const [start, setStart] = useState(startLocal);
  const [end, setEnd] = useState(endLocal);
  // Follow the committed selection while the user resizes it on the grid.
  useEffect(() => {
    setStart(startLocal);
    setEnd(endLocal);
  }, [startLocal, endLocal]);
  const [roleKey, setRoleKey] = useState(myRoles.length === 1 ? roleOptionKey(myRoles[0]!) : "");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startEndValid = !!start && !!end && new Date(end).getTime() > new Date(start).getTime();
  const hours = startEndValid
    ? Math.round(((new Date(end).getTime() - new Date(start).getTime()) / 3_600_000) * 100) / 100
    : 0;
  const canSubmit = startEndValid && hours > 0 && !!roleKey && !submitting && note.trim() !== "";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const body = new FormData();
      body.set("intent", "add-time-entry");
      body.set("startTime", new Date(start).toISOString());
      body.set("endTime", new Date(end).toISOString());
      body.set("date", start.slice(0, 10));
      body.set("hours", String(hours));
      const role = parseRoleOptionKey(roleKey);
      if (role) {
        body.set("assignmentType", role.assignmentType);
        body.set("roleRefId", role.roleRefId);
      }
      if (note.trim()) body.set("note", note.trim());
      const res = await fetch("/calendar", { method: "POST", credentials: "include", body });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        setError(j?.error ?? "Failed to add entry");
        return;
      }
      revalidator.revalidate();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className={cn(compact ? "p-3 space-y-3" : "space-y-4", formClass)}
    >
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor={`${idPrefix}-start`} className="block text-sm font-medium text-foreground mb-1">
            Starts
          </label>
          <DateField
            mode="datetime-local"
            value={start}
            onChange={(value) => setStart(value)}
            className="w-full"
            ariaLabel="Starts"
          />
        </div>
        <div>
          <label htmlFor={`${idPrefix}-end`} className="block text-sm font-medium text-foreground mb-1">
            Ends
          </label>
          <DateField
            mode="datetime-local"
            value={end}
            min={start || undefined}
            onChange={(value) => setEnd(value)}
            className="w-full"
            ariaLabel="Ends"
          />
        </div>
      </div>
      {!startEndValid ? (
        <p className="text-xs text-red-600">End must be after start.</p>
      ) : (
        <p className="text-xs text-muted-foreground">{hours.toFixed(2)} hrs</p>
      )}

      <div>
        <label htmlFor={`${idPrefix}-role`} className="block text-sm font-medium text-foreground mb-1">
          Role
        </label>
        {myRoles.length === 0 ? (
          <p className="text-xs text-red-600">{NO_ROLES_MESSAGE}</p>
        ) : (
          <Select
            value={roleKey}
            onChange={(v) => setRoleKey(v)}
            placeholder="Select a role…"
            options={myRoles.map((r) => ({ value: roleOptionKey(r), label: r.label }))}
            buttonClassName={`${formTrigger} ${
              roleKey ? "border-border" : "border-red-500"
            }`}
          />
        )}
      </div>

      <div>
        <label htmlFor={`${idPrefix}-note`} className="block text-sm font-medium text-foreground mb-1">
          Note
        </label>
        <textarea
          id={`${idPrefix}-note`}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          placeholder="What did you work on?"
          className="w-full px-3 py-2 text-sm border border-border rounded-md bg-background text-foreground resize-y min-h-[4.5rem]"
        />
      </div>

      {error && <p className="text-sm text-red-700">{error}</p>}

      <div className="flex items-center justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onClose}
          className="rounded-full border border-border px-4 py-2 text-sm font-medium hover:bg-muted"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={!canSubmit}
          className="rounded-full bg-os-accent px-5 py-2 text-sm font-medium text-os-bg transition-colors hover:bg-os-accent-hover disabled:opacity-50"
        >
          {submitting ? "Adding…" : "Add entry"}
        </button>
      </div>
    </form>
  );
}

export function TimesheetDragPopover({
  startLocal,
  endLocal,
  myRoles,
  onClose,
}: {
  startLocal: string;
  endLocal: string;
  myRoles: RoleInstance[];
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="cal-surface w-80 max-h-[26rem] overflow-y-auto rounded-lg"
      role="dialog"
      aria-modal="false"
      aria-label="New timesheet entry"
    >
      <div className="flex items-center justify-between px-3 py-2 border-b border-border sticky top-0 bg-card z-10">
        <h2 className="font-heading font-semibold text-sm text-foreground">New timesheet entry</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="p-1 text-muted-foreground hover:text-foreground rounded-md hover:bg-muted"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <TimesheetEntryForm
        startLocal={startLocal}
        endLocal={endLocal}
        myRoles={myRoles}
        onClose={onClose}
        compact
        idPrefix="ts-drag"
      />
    </div>
  );
}

// The Log hours button has no grid slot behind it, so its form opens as a
// centered dialog rather than a popover pinned to a slot the user never chose.
// Same form, same defaults — only the shell differs. Mount it to open it; the
// caller unmounts on close, so each open starts on a blank form.
export function LogHoursDialog({
  startLocal,
  endLocal,
  myRoles,
  onClose,
}: {
  startLocal: string;
  endLocal: string;
  myRoles: RoleInstance[];
  onClose: () => void;
}) {
  return (
    <Modal open onClose={onClose} labelledBy="log-hours-title">
      <ModalHeader
        titleId="log-hours-title"
        title="New timesheet entry"
        subtitle="Log hours against one of your paid roles."
        onClose={onClose}
        closeLabel="Close timesheet entry"
      />
      <TimesheetEntryForm
        startLocal={startLocal}
        endLocal={endLocal}
        myRoles={myRoles}
        onClose={onClose}
        idPrefix="ts-log"
      />
    </Modal>
  );
}

// Opened by clicking any TimeEntry on the Timesheet week grid (Manual, Block,
// or Meeting). Same shape as TimesheetDragPopover but pre-filled, with Save
// and Delete instead of Add.
export function TimesheetEditPopover({
  entry,
  startLocal,
  endLocal,
  myRoles,
  onClose,
}: {
  entry: TimeEntryDTO;
  startLocal: string;
  endLocal: string;
  myRoles: RoleInstance[];
  onClose: () => void;
}) {
  const { formClass, fieldLabel, formTrigger } = useOsChrome();
  const revalidator = useRevalidator();
  const [start, setStart] = useState(startLocal);
  const [end, setEnd] = useState(endLocal);
  // Follow the block while it's dragged/resized on the grid, so the form and
  // the block never disagree (same as TimesheetDragPopover). Typing into the
  // inputs still wins until the next grid drag.
  useEffect(() => {
    setStart(startLocal);
    setEnd(endLocal);
  }, [startLocal, endLocal]);
  const [roleKey, setRoleKey] = useState(
    entry.assignmentType && entry.roleRefId
      ? `${entry.assignmentType}:${entry.roleRefId}`
      : "",
  );
  const [note, setNote] = useState(entry.note ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startEndValid = !!start && !!end && new Date(end).getTime() > new Date(start).getTime();
  const hours = startEndValid
    ? Math.round(((new Date(end).getTime() - new Date(start).getTime()) / 3_600_000) * 100) / 100
    : 0;
  const busy = submitting || deleting;
  const canSubmit = startEndValid && hours > 0 && !!roleKey && !busy && note.trim() !== "";

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const body = new FormData();
      const role = parseRoleOptionKey(roleKey);
      body.set("intent", "update-time-entry");
      body.set("id", entry.id);
      body.set("startTime", new Date(start).toISOString());
      body.set("endTime", new Date(end).toISOString());
      body.set("date", start.slice(0, 10));
      body.set("hours", String(hours));
      body.set("assignmentType", role?.assignmentType ?? "");
      body.set("roleRefId", role?.roleRefId ?? "");
      body.set("note", note.trim());
      const res = await fetch("/calendar", { method: "POST", credentials: "include", body });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        setError(j?.error ?? "Failed to save entry");
        return;
      }
      revalidator.revalidate();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setSubmitting(false);
    }
  }

  async function del() {
    setDeleting(true);
    setError(null);
    try {
      const body = new FormData();
      body.set("intent", "delete-time-entry");
      body.set("id", entry.id);
      const res = await fetch("/calendar", { method: "POST", credentials: "include", body });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        setError(j?.error ?? "Failed to delete entry");
        return;
      }
      revalidator.revalidate();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div
      className="cal-surface w-80 max-h-[26rem] overflow-y-auto rounded-lg"
      role="dialog"
      aria-modal="false"
      aria-label="Edit timesheet entry"
    >
      <div className="flex items-center justify-between px-3 py-2 border-b border-border sticky top-0 bg-card z-10">
        <h2 className="font-heading font-semibold text-sm text-foreground">Edit timesheet entry</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="p-1 text-muted-foreground hover:text-foreground rounded-md hover:bg-muted"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <form onSubmit={submit} className={cn("p-3 space-y-3", formClass)}>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="ts-edit-start" className="block text-sm font-medium text-foreground mb-1">
              Starts
            </label>
            <DateField
              mode="datetime-local"
              value={start}
              onChange={(value) => setStart(value)}
              className="w-full"
              ariaLabel="Starts"
            />
          </div>
          <div>
            <label htmlFor="ts-edit-end" className="block text-sm font-medium text-foreground mb-1">
              Ends
            </label>
            <DateField
              mode="datetime-local"
              value={end}
              min={start || undefined}
              onChange={(value) => setEnd(value)}
              className="w-full"
              ariaLabel="Ends"
            />
          </div>
        </div>
        {!startEndValid ? (
          <p className="text-xs text-red-600">End must be after start.</p>
        ) : (
          <p className="text-xs text-muted-foreground">{hours.toFixed(2)} hrs</p>
        )}

        <div>
          <label htmlFor="ts-edit-role" className="block text-sm font-medium text-foreground mb-1">
            Role
          </label>
          <Select
            value={roleKey}
            onChange={(v) => setRoleKey(v)}
            placeholder="Select a role…"
            options={[
              ...(roleKey && !myRoles.some((r) => roleOptionKey(r) === roleKey)
                ? [{ value: roleKey, label: "Current role (no longer active)" }]
                : []),
              ...myRoles.map((r) => ({ value: roleOptionKey(r), label: r.label })),
            ]}
            buttonClassName={`${formTrigger} ${
              roleKey ? "border-border" : "border-red-500"
            }`}
          />
          {!roleKey && <p className="mt-1 text-xs text-red-600">Pick a role to save this entry.</p>}
        </div>

        <div>
          <label htmlFor="ts-edit-note" className="block text-sm font-medium text-foreground mb-1">
            Note
          </label>
          <textarea
            id="ts-edit-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            placeholder="What did you work on?"
            className="w-full px-3 py-2 text-sm border border-border rounded-md bg-background text-foreground resize-y min-h-[4.5rem]"
          />
        </div>

        {error && <p className="text-sm text-red-700">{error}</p>}

        <div className="flex items-center justify-between gap-2 pt-1">
          <button
            type="button"
            onClick={del}
            disabled={busy}
            className="px-3 py-2 text-sm font-medium rounded-md text-destructive hover:bg-destructive/10 disabled:opacity-50"
          >
            {deleting ? "Deleting…" : "Delete"}
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-2 text-sm font-medium rounded-md border border-border hover:bg-muted"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!canSubmit}
              className="px-4 py-2 rounded-md bg-os-accent text-os-bg text-sm font-medium hover:bg-os-accent/90 transition-colors disabled:opacity-50"
            >
              {submitting ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
