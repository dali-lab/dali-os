import { useState, useId } from "react";
import { Form, useFetcher } from "react-router";
import { Pencil, Check, X } from "lucide-react";
import { Button } from "~/components/ui/Button";
import { useConfirmSubmit } from "~/components/ui/dialog";
import { DateField } from "~/components/ui/DateField";
import { TimeField } from "~/components/ui/TimeField";
import { AddFormModal } from "~/education/components/AddFormModal";
import { MarkingList, type MatrixStudent } from "~/education/components/RosterMatrix";
import { toDatetimeLocal } from "~/education/components/OfferingFields";
import type { HubData } from "~/education/components/CourseHub";

type Session = HubData["sessions"][number];

type RosterEntry = { applicationId: string; name: string; status: string | null };

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
      {children}
    </h3>
  );
}

function MaterialModal({
  open,
  onClose,
  sessionId,
}: {
  open: boolean;
  onClose: () => void;
  sessionId: string;
}) {
  return (
    <AddFormModal
      open={open}
      onClose={onClose}
      title="Add material"
      intent="create-page"
      submitLabel="Create"
      hiddenFields={{ sessionId, kind: "FreeForm" }}
    >
      <div>
        <label className="text-xs font-semibold text-muted-foreground">Title</label>
        <input
          name="title"
          type="text"
          required
          placeholder="e.g. Slides, Notes, Code"
          className="mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm"
        />
      </div>
    </AddFormModal>
  );
}

function AssignmentModal({
  open,
  onClose,
  sessionId,
}: {
  open: boolean;
  onClose: () => void;
  sessionId: string;
}) {
  return (
    <AddFormModal
      open={open}
      onClose={onClose}
      title="Add assignment"
      intent="create-assignment"
      submitLabel="Create"
      hiddenFields={{ sessionId }}
    >
      <div className="flex flex-col gap-3">
        <div>
          <label className="text-xs font-semibold text-muted-foreground">Title</label>
          <input
            name="title"
            type="text"
            required
            placeholder="e.g. React hooks exercise"
            className="mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="text-xs font-semibold text-muted-foreground">Due date</label>
          <input
            name="dueAt"
            type="datetime-local"
            className="mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="text-xs font-semibold text-muted-foreground">Submission type</label>
          <select
            name="submissionType"
            className="mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm"
          >
            <option value="Link">Link</option>
            <option value="Doc">Doc</option>
            <option value="Complete">Mark complete</option>
          </select>
        </div>
        <div>
          <label className="text-xs font-semibold text-muted-foreground">
            Points <span className="font-normal">(optional)</span>
          </label>
          <input
            name="points"
            type="number"
            min={0}
            placeholder="e.g. 100"
            className="mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm"
          />
        </div>
      </div>
    </AddFormModal>
  );
}

/** Extract "YYYY-MM-DD" from a session.datetime (ISO string or Date). */
function extractDate(value: string | Date): string {
  const local = toDatetimeLocal(value);
  return local.slice(0, 10);
}

/** Extract "HH:mm" from a session.datetime. */
function extractTime(value: string | Date): string {
  const local = toDatetimeLocal(value);
  return local.includes("T") ? (local.split("T")[1] ?? "") : "";
}

export function SessionPaneInstructor({
  session,
  offeringId,
  basePath,
  tz,
  rosterForSession,
}: {
  session: Session;
  offeringId: string;
  basePath: string;
  tz: string;
  rosterForSession: {
    session: unknown;
    roster: RosterEntry[];
  } | null;
}) {
  const [materialOpen, setMaterialOpen] = useState(false);
  const [assignmentOpen, setAssignmentOpen] = useState(false);
  const [markingOpen, setMarkingOpen] = useState(false);
  const confirmSubmit = useConfirmSubmit();
  const deleteFetcher = useFetcher<{ error?: string }>();
  const updateFormId = useId();
  const renameFetcher = useFetcher<{ error?: string }>();

  // Date + time pickers for the update-session form
  const [sessionDate, setSessionDate] = useState(() => extractDate(session.datetime));
  const [sessionStartTime, setSessionStartTime] = useState(() => extractTime(session.datetime));
  const [sessionEndDate] = useState(() =>
    session.endsAt ? extractDate(session.endsAt) : "",
  );
  const [sessionEndTime, setSessionEndTime] = useState(() =>
    session.endsAt ? extractTime(session.endsAt) : "",
  );

  // Combine into datetime-local strings for hidden fields
  const datetimeValue = sessionDate && sessionStartTime
    ? `${sessionDate}T${sessionStartTime}`
    : "";
  // End date stays the same as start date (editing sessions doesn't cross midnight)
  const endsAtValue = sessionDate && sessionEndTime
    ? `${sessionDate}T${sessionEndTime}`
    : "";

  // Inline title rename
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(session.title ?? "");

  function handleRenameSave() {
    const fd = new FormData();
    fd.set("intent", "update-session");
    fd.set("sessionId", session.id);
    fd.set("title", renameValue);
    fd.set("datetime", datetimeValue || toDatetimeLocal(session.datetime));
    fd.set("endsAt", endsAtValue || "");
    fd.set("location", session.location ?? "");
    fd.set("notes", session.notes ?? "");
    fd.set("recordingUrl", session.recordingUrl ?? "");
    renameFetcher.submit(fd, { method: "post" });
    setRenaming(false);
  }

  // Transform roster to MatrixStudent[] for MarkingList
  const students: MatrixStudent[] = rosterForSession
    ? rosterForSession.roster.map((r) => ({
        applicationId: r.applicationId,
        name: r.name,
        marks: r.status ? { [session.id]: r.status as "Present" | "Absent" | "Excused" } : {},
        attended: r.status === "Present" ? 1 : 0,
      }))
    : [];

  return (
    <div id="session-pane" className="flex flex-col gap-6 border-t border-border pt-6 mt-2">
      {/* Session header with inline rename */}
      <div className="flex items-center gap-2">
        {renaming ? (
          <>
            <input
              autoFocus
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleRenameSave();
                if (e.key === "Escape") { setRenaming(false); setRenameValue(session.title ?? ""); }
              }}
              placeholder={`Session ${session.sequence}`}
              className="flex-1 rounded-md border border-accent-teal bg-card px-2 py-1 text-sm font-semibold text-foreground focus:outline-none focus:ring-1 focus:ring-accent-teal/60"
            />
            <button
              type="button"
              onClick={handleRenameSave}
              aria-label="Save title"
              className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-accent-teal text-white hover:bg-accent-teal/90 transition-colors"
            >
              <Check size={13} />
            </button>
            <button
              type="button"
              onClick={() => { setRenaming(false); setRenameValue(session.title ?? ""); }}
              aria-label="Cancel rename"
              className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-muted transition-colors"
            >
              <X size={13} />
            </button>
          </>
        ) : (
          <>
            <span className="text-sm font-semibold text-foreground">
              {session.title ?? `Session ${session.sequence}`}
            </span>
            <button
              type="button"
              onClick={() => setRenaming(true)}
              aria-label="Rename session"
              className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <Pencil size={12} />
            </button>
          </>
        )}
      </div>

      {/* (a) Update session */}
      <div>
        <SectionHeading>Session details</SectionHeading>
        <Form method="post" id={updateFormId} className="flex flex-col gap-3">
          <input type="hidden" name="intent" value="update-session" />
          <input type="hidden" name="sessionId" value={session.id} />
          {/* Hidden datetime fields built from date+time pickers */}
          <input type="hidden" name="datetime" value={datetimeValue} />
          <input type="hidden" name="endsAt" value={endsAtValue} />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-muted-foreground">Title</label>
              <input
                name="title"
                type="text"
                defaultValue={session.title ?? ""}
                placeholder={`Session ${session.sequence}`}
                className="mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground">Location</label>
              <input
                name="location"
                type="text"
                defaultValue={session.location ?? ""}
                className="mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm"
              />
            </div>
          </div>
          <div>
            <label className="text-xs font-semibold text-muted-foreground mb-1 block">
              Date
            </label>
            <DateField
              mode="date"
              value={sessionDate}
              onChange={setSessionDate}
              ariaLabel="Session date"
              className="w-full"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-muted-foreground mb-1 block">
                Start time
              </label>
              <TimeField
                value={sessionStartTime}
                onChange={setSessionStartTime}
                ariaLabel="Start time"
                className="w-full"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground mb-1 block">
                End time <span className="font-normal">(optional)</span>
              </label>
              <TimeField
                value={sessionEndTime}
                onChange={setSessionEndTime}
                ariaLabel="End time"
                className="w-full"
              />
            </div>
          </div>
          <div>
            <label className="text-xs font-semibold text-muted-foreground">Recording URL</label>
            <input
              name="recordingUrl"
              type="url"
              defaultValue={session.recordingUrl ?? ""}
              placeholder="https://…"
              className="mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-muted-foreground">
              Notes{" "}
              <span className="font-normal text-muted-foreground/60">
                — instructor only, hidden from the student lens
              </span>
            </label>
            <textarea
              name="notes"
              rows={3}
              defaultValue={session.notes ?? ""}
              className="mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm"
            />
          </div>
          <div className="flex items-center gap-2">
            <Button type="submit" size="sm">
              Save changes
            </Button>
          </div>
        </Form>
      </div>

      {/* (b) Mark by hand */}
      {rosterForSession && (
        <div>
          <SectionHeading>Attendance</SectionHeading>
          {!markingOpen ? (
            <button
              type="button"
              onClick={() => setMarkingOpen(true)}
              className="text-sm font-medium text-accent-teal hover:underline"
            >
              Mark attendance for this session
            </button>
          ) : (
            <MarkingList
              sessionId={session.id}
              students={students}
              onSaved={() => setMarkingOpen(false)}
            />
          )}
        </div>
      )}

      {/* (c) Add material + assignment */}
      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => setMaterialOpen(true)}
        >
          + Material
        </Button>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => setAssignmentOpen(true)}
        >
          + Assignment
        </Button>
      </div>

      {/* (d) Delete session */}
      <div>
        <deleteFetcher.Form
          method="post"
          onSubmit={confirmSubmit({
            title: "Delete session?",
            description: "This cannot be undone.",
            confirmLabel: "Delete",
            tone: "destructive",
          })}
        >
          <input type="hidden" name="intent" value="delete-session" />
          <input type="hidden" name="sessionId" value={session.id} />
          <button
            type="submit"
            className="text-xs font-semibold text-destructive/70 hover:text-destructive hover:underline"
          >
            Delete session
          </button>
        </deleteFetcher.Form>
        {deleteFetcher.data?.error && (
          <p className="mt-1 text-xs text-destructive">{deleteFetcher.data.error}</p>
        )}
      </div>

      <MaterialModal open={materialOpen} onClose={() => setMaterialOpen(false)} sessionId={session.id} />
      <AssignmentModal open={assignmentOpen} onClose={() => setAssignmentOpen(false)} sessionId={session.id} />
    </div>
  );
}
