import { Fragment, useState } from "react";

import { FileText, Plus, Send, Trash2 } from "lucide-react";
import { Avatar } from "~/components/ui/Avatar";
import { Select, Tooltip } from "~/components/ui/floating";
import { useOsChrome } from "~/components/os-chrome";
import { cn } from "~/lib/cn";
import { VIBE_META } from "../lib/vibe";
import type {
  GridCell,
  GridMenteeRow,
  GridMentorGroup,
  GridPerson,
} from "../lib/mentor-grid.server";
import { domainTermForms, type DomainTermForms, type TermForms } from "../lib/term-forms";
import { WeekFormsDialog, type WeekFormSide } from "./TermFormStatus";
import { MentorNoteOverlay } from "./MentorNoteOverlay";

// Core-only inline editing (behind the mentorship-manage flag). When present,
// each mentee row gains a reassign picker + a remove button. Left undefined for
// plain viewers and the hub, which stay read-only.
export type MentorGridEdit = {
  busy: boolean;
  // Reassign candidates for this row — roster mentors in the row's domain. The
  // current mentor is added by the grid itself (it knows the group), so this
  // may safely omit it.
  mentorOptionsFor: (row: GridMenteeRow) => { value: string; label: string }[];
  onReassign: (row: GridMenteeRow, mentorUserId: string) => void;
  onRemove: (row: GridMenteeRow) => void;
};

// Every week column is exactly this wide, header and cells alike.
const WEEK_COL = "2.5rem";
const IDENTITY_COL = "17rem";
// The check-in whose forms the Form pills open.
const FORM_WEEK = 5;
// An unfilled week (no note, or a note with no rating): the upcoming-week ring, but solid.
const UNFILLED = "border border-border text-muted-foreground/70";
function fullName(u: GridPerson) {
  return `${u.firstName} ${u.lastName}`.trim();
}

// Core-only Slack nudge for a mentor. Shown only when the mentor has at least
// one unfilled note.
export type MentorGridNudge = {
  count: number;
  busy: boolean;
  onNudge: () => void;
};

type GridProps = {
  weeks: number[];
  currentWeek: number | null;
  termId: string;
  // Flags due-but-unwritten weeks in red — reserved for core/admin oversight.
  highlightMissing: boolean;
  // Overrides the mentor's name in the group header (the hub shows one group
  // where the viewer is the mentor, so it reads "My mentees").
  heading?: string;
  edit?: MentorGridEdit;
  termForms?: TermForms;
};

// One mentor on their own — the hub's "My mentees".
export function MentorGrid({
  group,
  nudge,
  ...rest
}: GridProps & { group: GridMentorGroup; nudge?: MentorGridNudge }) {
  return <MentorGridTable groups={[group]} nudgeFor={() => nudge} {...rest} />;
}

// Mentor cards: one soft card per mentor (collapsible, open by default) with a
// compact row per mentee. Every card uses the same column template, so the week
// numbers and circles line up in every row of every card.
export function MentorGridTable({
  groups,
  nudgeFor,
  weeks,
  currentWeek,
  termId,
  highlightMissing,
  heading,
  edit,
  termForms,
}: GridProps & {
  groups: GridMentorGroup[];
  nudgeFor?: (group: GridMentorGroup) => MentorGridNudge | undefined;
}) {
  const formsFor = (domainId: string) => (termForms ? domainTermForms(termForms, domainId) : null);
  const showForms = groups.some((g) =>
    g.rows.some((r) => {
      const f = formsFor(r.domainId);
      return f?.mentee.form || f?.mentor.form;
    }),
  );
  // The note open in the overlay; the cards stay mounted behind it.
  const [openNoteId, setOpenNoteId] = useState<string | null>(null);
  // One template for every row of every card: identity, exactly ten equal
  // compact week columns, then (when forms are linked) a rightmost column for
  // the Form pills that takes the remaining width.
  const columns = [
    IDENTITY_COL,
    // Ten equal week columns; the Week 5 check-in bubble takes one more of the
    // same width right after week 5, so it reads as part of the timeline.
    ...(weeks.length === 0
      ? [WEEK_COL]
      : weeks.flatMap((w) => [WEEK_COL, ...(showForms && w === FORM_WEEK ? [WEEK_COL] : [])])),
    edit ? "auto" : null,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <div className="flex flex-col gap-6">
      {groups.map((group) => (
        <MentorGroup
          key={group.mentor.id}
          group={group}
          weeks={weeks}
          heading={heading}
          nudge={nudgeFor?.(group)}
          columns={columns}
          currentWeek={currentWeek}
          termId={termId}
          highlightMissing={highlightMissing}
          edit={edit}
          formsFor={formsFor}
          showForms={showForms}
          onOpenNote={(id) => {
            // Dev-preview notes have nothing to load.
            if (!id.startsWith("mock-")) setOpenNoteId(id);
          }}
        />
      ))}
      <MentorNoteOverlay noteId={openNoteId} onClose={() => setOpenNoteId(null)} />
    </div>
  );
}

function MentorGroup({
  group,
  weeks,
  heading,
  nudge,
  columns,
  currentWeek,
  termId,
  highlightMissing,
  edit,
  formsFor,
  showForms,
  onOpenNote,
}: {
  group: GridMentorGroup;
  weeks: number[];
  heading?: string;
  nudge?: MentorGridNudge;
  columns: string;
  currentWeek: number | null;
  termId: string;
  highlightMissing: boolean;
  edit?: MentorGridEdit;
  formsFor: (domainId: string) => DomainTermForms | null;
  showForms: boolean;
  onOpenNote: (noteId: string) => void;
}) {
  const { panel } = useOsChrome();
  const [open, setOpen] = useState(true);
  const [dialog, setDialog] = useState<WeekFormSide[] | null>(null);
  const mentorName = fullName(group.mentor);

  // The mentor answers one form per domain; every Form pill in the card shares
  // one mentor entry — the first with a response, else the first linked.
  const mentorSlots = group.rows.flatMap((r) => {
    const slot = formsFor(r.domainId)?.mentor;
    return slot?.form ? [slot] : [];
  });
  const mentorSlot = mentorSlots.find((sl) => sl.responses[group.mentor.id]) ?? mentorSlots[0];
  const mentorSide: WeekFormSide = {
    role: "mentor",
    personId: group.mentor.id,
    photoUrl: group.mentor.photoUrl,
    personName: mentorName,
    formName: mentorSlot?.form?.name ?? null,
    response: mentorSlot?.responses[group.mentor.id],
  };
  const menteeSide = (row: GridMenteeRow): WeekFormSide => {
    const slot = formsFor(row.domainId)?.mentee;
    return {
      role: "mentee",
      personId: row.menteeId,
      photoUrl: row.mentee.photoUrl,
      personName: fullName(row.mentee),
      formName: slot?.form?.name ?? null,
      response: slot?.responses[row.menteeId],
    };
  };

  return (
    <section className={cn(panel, "flex flex-col px-5 py-3")}>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex min-w-0 items-center gap-2 text-left"
        >
          {heading ? (
            <span className="font-medium text-foreground">{heading}</span>
          ) : (
            <>
              <Avatar photoUrl={group.mentor.photoUrl} name={mentorName} size="sm" userId={group.mentor.id} />
              <span className="truncate font-medium text-foreground">{mentorName}</span>
            </>
          )}
        </button>
        {nudge && nudge.count > 0 && (
          <Tooltip content={`Slack-DM ${mentorName} about their ${nudge.count} unfilled note${nudge.count === 1 ? "" : "s"}`}>
            <button
              type="button"
              onClick={nudge.onNudge}
              disabled={nudge.busy}
              className="os-edit-btn ml-auto shrink-0 !gap-1.5 !px-4 !py-1.5 !text-xs disabled:opacity-50"
            >
              <Send className="h-3.5 w-3.5 text-os-grey" aria-hidden />
              {nudge.busy ? "Sending…" : "Nudge"}
            </button>
          </Tooltip>
        )}
      </div>
      {open && (
        <div className="overflow-x-auto">
          <div role="table" className="min-w-max pt-1">
            {edit && (
              <div
                role="row"
                className="grid items-end gap-x-1 pt-1 text-[11px] font-medium text-muted-foreground"
                style={{ gridTemplateColumns: columns }}
              >
                <span role="columnheader"><span className="sr-only">Mentee</span></span>
                {weeks.map((w) => (
                  <Fragment key={w}>
                    <span role="columnheader" className="sr-only">Week {w}</span>
                    {showForms && w === FORM_WEEK && <span />}
                  </Fragment>
                ))}
                <span role="columnheader" className="pl-3">Mentor</span>
              </div>
            )}
            {group.rows.map((row, i) => {
              const side = menteeSide(row);
              return (
                <div
                  key={row.key}
                  role="row"
                  className={cn(
                    "grid items-center gap-x-1 py-2",
                    i > 0 && "border-t border-os-container/40",
                  )}
                  style={{ gridTemplateColumns: columns }}
                >
                  <div role="cell" className="flex min-w-0 items-center gap-3 pr-3">
                    <Avatar photoUrl={row.mentee.photoUrl} name={fullName(row.mentee)} size="sm" className="shrink-0" />
                    <div className="flex min-w-0 flex-col leading-tight">
                      <span className="truncate font-medium text-foreground" title={fullName(row.mentee)}>
                        {fullName(row.mentee)}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {row.projectName} · {row.domainCode}
                      </span>
                    </div>
                  </div>
                  {row.cells.map((cell) => (
                    <Fragment key={cell.week}>
                      <div role="cell" className="flex justify-center">
                        <GridCellView
                          cell={cell}
                          row={row}
                          termId={termId}
                          highlightMissing={highlightMissing}
                          isCurrent={cell.week === currentWeek}
                          onOpenNote={onOpenNote}
                        />
                      </div>
                      {showForms && cell.week === FORM_WEEK && (
                        <div role="cell" className="flex justify-center">
                          <FormBubble
                            mentor={Boolean(mentorSide.response)}
                            mentee={Boolean(side.response)}
                            label={`Week ${FORM_WEEK} checkin · Mentor ${mentorSide.response ? "submitted" : "not submitted"}, Mentee ${side.response ? "submitted" : "not submitted"}`}
                            ariaLabel={`Open Week ${FORM_WEEK} forms — ${mentorName} and ${fullName(row.mentee)}`}
                            onClick={() => setDialog([mentorSide, side])}
                          />
                        </div>
                      )}
                    </Fragment>
                  ))}
                  {edit && (
                    <div role="cell" className="pl-3 whitespace-nowrap">
                      <div className="inline-flex items-center gap-2">
                        <Select
                          ariaLabel={`Reassign ${fullName(row.mentee)}'s mentor`}
                          value={group.mentor.id}
                          onChange={(v) => {
                            if (v && v !== group.mentor.id) edit.onReassign(row, v);
                          }}
                          options={[
                            { value: group.mentor.id, label: mentorName },
                            ...edit.mentorOptionsFor(row).filter((o) => o.value !== group.mentor.id),
                          ]}
                          buttonClassName="min-w-[9rem] text-xs"
                        />
                        {row.manual && (
                          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">manual</span>
                        )}
                        <button
                          type="button"
                          onClick={() => edit.onRemove(row)}
                          disabled={edit.busy}
                          className="text-muted-foreground hover:text-destructive disabled:opacity-50"
                          title="Remove pairing"
                        >
                          <Trash2 className="w-4 h-4" aria-hidden />
                          <span className="sr-only">Remove {fullName(row.mentee)} pairing</span>
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
      <WeekFormsDialog open={dialog != null} onClose={() => setDialog(null)} sides={dialog ?? []} />
    </section>
  );
}

// The Week 5 check-in as a bubble in the timeline: left half = the mentor's
// form, right half = the mentee's. Both halves filled = both submitted, one
// half = only that person has, empty = neither.
function FormBubble({
  mentor,
  mentee,
  label,
  ariaLabel,
  onClick,
}: {
  mentor: boolean;
  mentee: boolean;
  label: string;
  ariaLabel: string;
  onClick: () => void;
}) {
  return (
    <Tooltip content={label}>
      <button
        type="button"
        onClick={onClick}
        aria-label={ariaLabel}
        className="relative inline-flex h-6 w-6 items-center justify-center overflow-hidden rounded-full border border-border transition hover:ring-2 hover:ring-border hover:ring-offset-1"
      >
        <span aria-hidden className={cn("absolute inset-y-0 left-0 w-1/2", mentor && "bg-[#9fe0a8]")} />
        <span aria-hidden className={cn("absolute inset-y-0 right-0 w-1/2", mentee && "bg-[#9fe0a8]")} />
        <FileText aria-hidden className="relative h-3 w-3 text-black/40" />
      </button>
    </Tooltip>
  );
}

// A single week cell: a submitted note (colored by vibe, links to the note), a
// missing note (a due week with no note — red for core/admin, neutral for a
// plain mentor; clickable to create when the viewer is the mentor), or a
// future week (muted, inert).
function GridCellView({
  cell,
  row,
  termId,
  highlightMissing,
  isCurrent,
  onOpenNote,
}: {
  cell: GridCell;
  row: GridMenteeRow;
  termId: string;
  highlightMissing: boolean;
  isCurrent: boolean;
  onOpenNote: (noteId: string) => void;
}) {
  const [busy, setBusy] = useState(false);

  const base =
    "inline-flex h-6 w-6 items-center justify-center rounded-full text-[10px] transition";
  // The week number rides faintly inside its circle; currentWeek reads bolder.
  const num = (
    <span aria-hidden className={cn("leading-none", isCurrent && "font-bold")}>
      {cell.week}
    </span>
  );

  // Submitted: open the existing note, colored by its vibe.
  if (cell.state === "submitted") {
    // A started note with no rating still reads as "not filled in". Under Core
    // oversight, flag it (amber dashed) like a missing cell so the grid matches
    // the "Not filled in" filter; otherwise it's a neutral gray dot.
    const cls = cell.vibe
      ? `${VIBE_META[cell.vibe].dot} text-black/35`
      : UNFILLED;
    const vibeLabel = cell.vibe ? VIBE_META[cell.vibe].label : "no rating yet";
    const vibeDesc = cell.vibe === "Good"
      ? "Mentor marked this week as going well."
      : cell.vibe === "Ok"
      ? "Mentor flagged some areas to work on."
      : cell.vibe === "Bad"
      ? "Mentor flagged something concerning — follow up."
      : "This week's note has no rating yet — not filled in.";
    return (
      <Tooltip
        content={`Week ${cell.week} · ${vibeLabel}. ${vibeDesc}`}
        variant="rich"
      >
        {/* A real link (new tab / copy address still work); a plain click opens
            the overlay instead of navigating. */}
        <a
          href={`/mentorship/notes/${cell.noteId}`}
          onClick={(e) => {
            if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
            e.preventDefault();
            if (cell.noteId) onOpenNote(cell.noteId);
          }}
          className={`${base} ${cls} hover:ring-2 hover:ring-offset-1 hover:ring-border`}
        >
          {num}
          <span className="sr-only">Open note</span>
        </a>
      </Tooltip>
    );
  }

  // No note yet. Missing weeks read red only under oversight; otherwise the gap
  // is a neutral, still-actionable slot.
  const missing = cell.state === "missing";
  const style =
    // The earlier look, with the two empty states swapped: a missed (due, no
    // note) week is the filled grey "–" dot; an upcoming week is the dashed outline.
    missing ? UNFILLED : "border border-dashed border-border text-muted-foreground/50";
  const hover =
    "hover:bg-muted/60";

  // A non-mentor viewer has nothing to open.
  if (!cell.canCreate) {
    return (
      <Tooltip
        content={`Week ${cell.week} · ${missing ? "no note written yet" : "not yet due"}`}
      >
        <span className={`${base} ${style}`}>
          {num}
        </span>
      </Tooltip>
    );
  }

  // The mentor: clicking opens the week's note, creating it if needed.
  async function openNote() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/mentorship/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          menteeId: row.menteeId,
          projectId: row.projectId,
          termId,
          domainId: row.domainId,
          weekOf: cell.weekOfIso,
        }),
      });
      if (!res.ok) throw new Error(`create failed: ${res.status}`);
      const { id } = (await res.json()) as { id: string };
      onOpenNote(id);
    } catch {
      // fall through to re-enable the button
    }
    setBusy(false);
  }

  return (
    <Tooltip content={`Week ${cell.week} — click to open or create this week's note`}>
      <button
        type="button"
        onClick={openNote}
        disabled={busy}
        className={`group ${base} ${style} ${hover}`}
      >
        <span className="group-hover:hidden">{num}</span>
        <Plus className="hidden h-3 w-3 text-foreground group-hover:block" aria-hidden />
        <span className="sr-only">Open note for week {cell.week}</span>
      </button>
    </Tooltip>
  );
}
