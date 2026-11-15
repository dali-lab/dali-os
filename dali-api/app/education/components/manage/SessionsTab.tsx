import { useState } from "react";
import { useSearchParams } from "react-router";
import { useConfirmSubmit } from "~/components/ui/dialog";
import { useUserTimeZone } from "~/hooks/useUserTimeZone";
import { FIELD_COL, WEEKDAYS, WEEKDAY_NAMES } from "./manage-ui";
import { SessionMaterials } from "./SessionMaterials";
import { Form } from "react-router";
import { AddFormModal } from "~/education/components/AddFormModal";
import { Button } from "~/components/ui/Button";
import { isMultiSession } from "~/education/lib/offering-type";
import { toDatetimeLocal } from "~/education/components/OfferingFields";
import { DateField } from "~/components/ui/DateField";
import { formatSessionWhen } from "~/lib/display";

import type { ManageOfferingLoaderData } from "~/education/routes/education.manage.$offeringId";

export function SessionsTab({ data }: { data: ManageOfferingLoaderData }) {
  const { offering, materials, offeringFiles, assignments, attendanceMatrix } = data;
  const tz = useUserTimeZone();
  const confirmSubmit = useConfirmSubmit();
  const [, setSearchParams] = useSearchParams();
  const [addSessionOpen, setAddSessionOpen] = useState(false);
  const [generateOpen, setGenerateOpen] = useState(false);

  // Per-session rollups so the Sessions tab connects to the rest of the offering
  // (attendance, materials, assignments) instead of being a bare date list.
  const totalRosterStudents = attendanceMatrix.students.length;
  const presentBySession = new Map<string, number>();
  for (const s of attendanceMatrix.sessions) {
    presentBySession.set(
      s.id,
      attendanceMatrix.students.filter((st) => st.marks[s.id] === "Present").length,
    );
  }
  // Pages and uploaded files are one thing to an instructor ("the material for
  // week 3"), and both carry a sessionId, so the session card treats them as
  // one list and remembers which intent each needs on the way back.
  const allMaterials: {
    id: string;
    title: string;
    kind: "page" | "file";
    sessionId: string | null;
    href: string;
  }[] = [];
  for (const top of materials) {
    // A folder holds material, it isn't material — only its children (and
    // top-level pages, which are never folders when isFolder is false) attach
    // to a session.
    for (const m of [...(top.isFolder ? [] : [top]), ...top.children]) {
      allMaterials.push({
        id: m.id,
        title: m.title,
        kind: "page",
        sessionId: m.sessionId,
        href: `/documents/${m.id}`,
      });
    }
  }
  for (const f of offeringFiles) {
    allMaterials.push({
      id: f.id,
      title: f.title,
      kind: "file",
      sessionId: f.sessionId,
      href: f.href,
    });
  }
  const assignmentsBySession = new Map<string, { id: string; title: string }[]>();
  for (const a of assignments) {
    if (!a.sessionId) continue;
    const list = assignmentsBySession.get(a.sessionId) ?? [];
    list.push({ id: a.id, title: a.title });
    assignmentsBySession.set(a.sessionId, list);
  }

  return (
        // A term's worth of sessions is a long scroll of near-identical cards,
        // so the list of titles stays on screen beside them as the way in.
        // Both columns fill the page's scroll region and scroll inside it, so
        // the nav stays put and the two always end on the same line.
        <div className="flex min-h-0 flex-1 items-stretch gap-6">
          {offering.sessions.length > 1 && (
            <nav
              aria-label="Sessions"
              className="hidden w-56 shrink-0 flex-col gap-1 overflow-y-auto rounded-os-card bg-os-card p-2 lg:flex"
            >
              {offering.sessions.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => {
                    document
                      .getElementById(`session-${s.id}`)
                      ?.scrollIntoView({ behavior: "smooth", block: "start" });
                  }}
                  className="rounded-os-item px-3 py-2 text-left text-sm text-os-grey transition-colors hover:bg-os-well hover:text-foreground"
                >
                  <span className="block truncate font-medium text-foreground">
                    {s.title ? `${s.sequence}. ${s.title}` : `Session ${s.sequence}`}
                  </span>
                  <span className="block truncate text-[13px]">
                    {formatSessionWhen(s.datetime, s.endsAt, tz)}
                  </span>
                </button>
              ))}
            </nav>
          )}
        <div className="flex min-w-0 flex-1 flex-col gap-4 lg:overflow-y-auto lg:pb-2 lg:pr-1">
          {offering.sessions.length === 0 ? (
            <p className="rounded-os-card bg-os-card px-6 py-5 text-sm italic text-os-grey">
              No sessions yet.{" "}
              {isMultiSession(offering.type)
                ? `A ${offering.type.toLowerCase()} needs at least one session before it can publish.`
                : "Add the workshop's session below."}
            </p>
          ) : (
            <ul className="flex flex-col gap-4">
              {offering.sessions.map((s) => (
                <li
                  key={s.id}
                  id={`session-${s.id}`}
                  // Clear the sticky nav's own top offset when scrolled to.
                  className="scroll-mt-4 rounded-os-card bg-os-card p-5"
                >
                  <div className="mb-5 flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <h3 className="font-heading text-[19px] font-semibold text-foreground">
                        {s.title ? `${s.sequence}. ${s.title}` : `Session ${s.sequence}`}
                      </h3>
                      <p className="mt-0.5 text-sm text-os-grey">
                        {formatSessionWhen(s.datetime, s.endsAt, tz)}
                      </p>
                    </div>
                    <Form
                      method="post"
                      onSubmit={confirmSubmit({
                        title: "Delete this session?",
                        description: "Attendance recorded for it is deleted with it.",
                        confirmLabel: "Delete",
                        tone: "destructive",
                      })}
                    >
                      <input type="hidden" name="intent" value="delete-session" />
                      <input type="hidden" name="sessionId" value={s.id} />
                      <Button type="submit" variant="ghost" size="sm">
                        Delete
                      </Button>
                    </Form>
                  </div>
                  {/* Topic leads on its own line: it's the session's name and
                      the longest thing you type here, so sharing a row with
                      three short fields left it a stub. */}
                  <Form method="post" className="os-form flex flex-col gap-4">
                    <input type="hidden" name="intent" value="update-session" />
                    <input type="hidden" name="sessionId" value={s.id} />
                    <label className={FIELD_COL}>
                      <span className="os-field-label">Topic</span>
                      <input
                        type="text"
                        name="title"
                        placeholder="e.g. Intro to Figma"
                        defaultValue={s.title ?? ""}
                        className="w-full"
                      />
                    </label>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <label className={FIELD_COL}>
                        <span className="os-field-label">Starts</span>
                        <DateField
                          mode="datetime-local"
                          name="datetime"
                          required
                          defaultValue={toDatetimeLocal(s.datetime)}
                          className="w-full"
                          ariaLabel="Session start date and time"
                        />
                      </label>
                      <label className={FIELD_COL}>
                        <span className="os-field-label">Ends</span>
                        <DateField
                          mode="datetime-local"
                          name="endsAt"
                          defaultValue={s.endsAt ? toDatetimeLocal(s.endsAt) : ""}
                          className="w-full"
                          ariaLabel="Session end date and time"
                        />
                      </label>
                      <label className={FIELD_COL}>
                        <span className="os-field-label">Location</span>
                        <input
                          type="text"
                          name="location"
                          defaultValue={s.location ?? ""}
                          className="w-full"
                        />
                      </label>
                      <label className={FIELD_COL}>
                        <span className="os-field-label">Recording URL</span>
                        <input
                          type="url"
                          name="recordingUrl"
                          defaultValue={s.recordingUrl ?? ""}
                          className="w-full"
                        />
                      </label>
                    </div>
                    <label className={FIELD_COL}>
                      <span className="os-field-label">Notes for students</span>
                      <textarea
                        name="notes"
                        rows={2}
                        defaultValue={s.notes ?? ""}
                        placeholder="Prep work, what to bring, links. Students see this on the course page."
                        className="w-full"
                      />
                    </label>
                    <div className="flex justify-end">
                      <Button type="submit" variant="secondary">
                        Save
                      </Button>
                    </div>
                  </Form>
                  {/* What this session connects to — attendance, materials and
                      assignments — so the tab isn't just a bare date list. */}
                  <div className="mt-5 flex flex-col gap-2 rounded-os-item bg-os-well px-4 py-3 text-sm">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="text-os-grey">
                        {totalRosterStudents > 0
                          ? `${presentBySession.get(s.id) ?? 0} of ${totalRosterStudents} present`
                          : "No enrolled students yet"}
                      </span>
                      <button
                        type="button"
                        onClick={() => setSearchParams({ tab: "roster", session: s.id })}
                        className="font-medium text-os-accent hover:underline"
                      >
                        Take attendance
                      </button>
                    </div>
                    <SessionMaterials
                      offeringId={offering.id}
                      sessionId={s.id}
                      materials={allMaterials}
                    />
                    {(assignmentsBySession.get(s.id)?.length ?? 0) > 0 && (
                      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                        <span className="text-os-grey">Assignments:</span>
                        {assignmentsBySession.get(s.id)!.map((a) => (
                          <a
                            key={a.id}
                            href={`/education/manage/assignments/${a.id}`}
                            className="text-foreground hover:text-os-accent hover:underline"
                          >
                            {a.title}
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}

          {/* Adding a session is occasional; the form sat open permanently above
              the list you actually came to read. The button reveals it. */}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant={addSessionOpen ? "secondary" : "primary"}
              onClick={() => setAddSessionOpen((o) => !o)}
            >
              Add session
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setGenerateOpen((o) => !o)}
            >
              Generate weekly series
            </Button>
          </div>

          <AddFormModal
            open={addSessionOpen}
            onClose={() => setAddSessionOpen(false)}
            title="Add session"
            intent="add-session"
            submitLabel="Add session"
          >
            <label className={FIELD_COL}>
              <span className="os-field-label">Topic</span>
              <input type="text" name="title" placeholder="e.g. Intro to Figma" />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className={FIELD_COL}>
                <span className="os-field-label">Starts</span>
                <DateField
                  mode="datetime-local"
                  name="datetime"
                  required
                  className="w-full"
                  ariaLabel="Session start date and time"
                />
              </label>
              <label className={FIELD_COL}>
                <span className="os-field-label">Ends</span>
                <DateField
                  mode="datetime-local"
                  name="endsAt"
                  className="w-full"
                  ariaLabel="Session end date and time"
                />
              </label>
            </div>
            <label className={FIELD_COL}>
              <span className="os-field-label">Location</span>
              <input type="text" name="location" placeholder="Sudikoff 007" />
            </label>
            <label className={FIELD_COL}>
              <span className="os-field-label">Notes for students</span>
              <textarea
                name="notes"
                rows={2}
                placeholder="Prep work, what to bring, links. Students see this on the course page."
              />
            </label>
          </AddFormModal>

          <AddFormModal
            open={generateOpen}
            onClose={() => setGenerateOpen(false)}
            title="Generate a session series"
            subtitle="Pick the weekdays this class meets — a Mon/Wed class fills in both, in date order. Rename or retime any session afterward."
            intent="generate-sessions"
            submitLabel="Generate"
          >
            <label className={FIELD_COL}>
              <span className="os-field-label">Starting the week of</span>
              <DateField
                mode="date"
                name="startDate"
                required
                className="w-full"
                ariaLabel="Series start date"
              />
            </label>
            <div className={FIELD_COL}>
              <span className="os-field-label">Meets on</span>
              <div className="flex flex-wrap gap-2">
                {WEEKDAYS.map((label, i) => (
                  <label
                    key={i}
                    className="relative cursor-pointer select-none"
                    title={WEEKDAY_NAMES[i]}
                  >
                    <input
                      type="checkbox"
                      name="weekdays"
                      value={i}
                      className="peer sr-only"
                    />
                    <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-os-well text-sm font-medium text-os-grey transition-colors peer-checked:bg-os-accent peer-checked:text-os-card peer-focus-visible:ring-2 peer-focus-visible:ring-os-accent/40">
                      {label}
                    </span>
                  </label>
                ))}
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <label className={FIELD_COL}>
                <span className="os-field-label">Starts</span>
                <DateField
                  mode="time"
                  name="startTime"
                  required
                  className="w-full"
                  ariaLabel="Session start time"
                />
              </label>
              <label className={FIELD_COL}>
                <span className="os-field-label">Ends</span>
                <DateField
                  mode="time"
                  name="endTime"
                  className="w-full"
                  ariaLabel="Session end time"
                />
              </label>
              <label className={FIELD_COL}>
                <span className="os-field-label">Weeks</span>
                <input type="number" name="weeks" min={1} max={26} defaultValue={6} />
              </label>
            </div>
            <label className={FIELD_COL}>
              <span className="os-field-label">Location</span>
              <input type="text" name="location" placeholder="Sudikoff 007" />
            </label>
          </AddFormModal>
        </div>
        </div>
  );
}
