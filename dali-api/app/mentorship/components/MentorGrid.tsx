import { useState } from "react";

import { Plus, Send, Trash2 } from "lucide-react";
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
import { domainTermForms, type TermForms } from "../lib/term-forms";
import { WeekFormsCard } from "./TermFormStatus";
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
const WEEK_COL = "2.25rem";

function fullName(u: GridPerson) {
  return `${u.firstName} ${u.lastName}`.trim();
}

// One mentor's card: their mentees down the rows, weeks across the columns.
// `heading` overrides the mentor's name (the hub shows a single group where the
// viewer is the mentor, so it labels the section "My mentees" instead).
// `highlightMissing` flags due-but-unwritten weeks in red — reserved for
// core/admin oversight; for a plain mentor the gaps read neutrally.
// Core-only Slack nudge for this mentor.
// Shown only when the mentor has at least one unfilled note.
export type MentorGridNudge = {
  count: number;
  busy: boolean;
  onNudge: () => void;
};

export function MentorGrid({
  group,
  weeks,
  currentWeek,
  termId,
  highlightMissing,
  heading,
  edit,
  nudge,
  termForms,
}: {
  group: GridMentorGroup;
  weeks: number[];
  currentWeek: number | null;
  termId: string;
  highlightMissing: boolean;
  heading?: string;
  edit?: MentorGridEdit;
  nudge?: MentorGridNudge;
  termForms?: TermForms;
}) {
  const formsFor = (domainId: string) => (termForms ? domainTermForms(termForms, domainId) : null);
  // The week 5 section appears when any of this mentor's domains links a form.
  const showForms = group.rows.some((r) => {
    const f = formsFor(r.domainId);
    return f?.mentee.form || f?.mentor.form;
  });
  // The mentor answers one form per domain; show the first that has a response
  // (else the first linked), since the card carries a single mentor entry.
  const mentorSlots = group.rows.flatMap((r) => {
    const slot = formsFor(r.domainId)?.mentor;
    return slot?.form ? [slot] : [];
  });
  const mentorSlot =
    mentorSlots.find((sl) => sl.responses[group.mentor.id]) ?? mentorSlots[0];
  const { panel, panelPad } = useOsChrome();
  // The note open in the overlay; the grid stays mounted behind it.
  const [openNoteId, setOpenNoteId] = useState<string | null>(null);
  // Header and every mentee row share this one template, so each week number
  // sits in the same fixed-width column as its circle — in every row, in every
  // mentor card — and the week 5 section / edit column only ever extend it to
  // the right.
  const columns = [
    "15rem",
    // The track stretches to fill the panel; the 2.25rem floor keeps a circle
    // and its number in a clean column on narrow screens.
    `repeat(${Math.max(weeks.length, 1)}, minmax(${WEEK_COL}, 1fr))`,
    edit ? "auto" : null,
  ]
    .filter(Boolean)
    .join(" ");
  const nudgeEl =
    nudge && nudge.count > 0 ? (
      <Tooltip content={`Slack-DM ${fullName(group.mentor)} about their ${nudge.count} unfilled note${nudge.count === 1 ? "" : "s"}`}>
        <button
          type="button"
          onClick={nudge.onNudge}
          disabled={nudge.busy}
          className="os-edit-btn shrink-0 !gap-1 !px-2 !py-0.5 !text-xs disabled:opacity-50"
        >
          <Send className="w-3 h-3 text-os-grey" aria-hidden />
          {nudge.busy ? "Sending…" : "Nudge"}
        </button>
      </Tooltip>
    ) : null;
  return (
    <section className={cn(panel, panelPad, "flex flex-col gap-2")}>
      {heading && <h2 className="font-medium text-foreground">{heading}</h2>}
      <div className="overflow-x-auto">
        <div className="flex w-full min-w-[44rem] items-start gap-4">
          <div className="flex min-w-0 flex-1 flex-col justify-between gap-3 self-stretch">
          <div role="table" className="flex flex-col">
            {edit && (
              <div
                role="row"
                className="grid items-end gap-x-1 pb-1"
                style={{ gridTemplateColumns: columns }}
              >
                <span role="columnheader"><span className="sr-only">Mentee</span></span>
                {weeks.map((w) => (
                  <span key={w} role="columnheader" className="sr-only">Week {w}</span>
                ))}
                <span role="columnheader" className="pl-3 text-left font-medium text-muted-foreground">
                  Mentor
                </span>
              </div>
            )}
            {group.rows.map((row, i) => (
              <div
                key={row.key}
                role="row"
                className={cn(
                  "grid items-center gap-x-1 py-2",
                  // Several mentees: a hairline keeps each pair a unit.
                  i > 0 && "border-t border-os-container/60",
                )}
                style={{ gridTemplateColumns: columns }}
              >
                {/* Mentee photo, name, and project (wraps rather than truncating). */}
                <div role="cell" className="flex items-center gap-3 pr-3 min-w-0">
                  <Avatar photoUrl={row.mentee.photoUrl} name={fullName(row.mentee)} size="sm" className="shrink-0" />
                  <div className="flex flex-col leading-tight min-w-0">
                    <span className="font-medium text-foreground truncate" title={fullName(row.mentee)}>
                      {fullName(row.mentee)}
                    </span>
                    {/* Wraps instead of truncating, so the project is never cut off. */}
                    <span className="text-xs text-muted-foreground">
                      {row.projectName} · {row.domainCode}
                    </span>
                  </div>
                </div>
                {row.cells.map((cell) => (
                  <div key={cell.week} role="cell" className="flex flex-col items-center gap-1">
                    {/* The week number rides directly above its circle. */}
                    <span
                      className={cn(
                        "text-[11px] leading-none",
                        cell.week === currentWeek
                          ? "font-bold text-foreground"
                          : "font-medium text-muted-foreground",
                      )}
                    >
                      <Tooltip
                        content={cell.week === currentWeek ? `Week ${cell.week} (current term week)` : `Week ${cell.week}`}
                      >
                        <span>{cell.week}</span>
                      </Tooltip>
                    </span>
                    <GridCellView
                      cell={cell}
                      row={row}
                      termId={termId}
                      highlightMissing={highlightMissing}
                      onOpenNote={(id) => {
                        // Dev-preview notes have nothing to load.
                        if (!id.startsWith("mock-")) setOpenNoteId(id);
                      }}
                    />
                  </div>
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
                          { value: group.mentor.id, label: fullName(group.mentor) },
                          ...edit
                            .mentorOptionsFor(row)
                            .filter((o) => o.value !== group.mentor.id),
                        ]}
                        buttonClassName="min-w-[9rem] text-xs"
                      />
                      {row.manual && (
                        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                          manual
                        </span>
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
            ))}
          </div>
          {/* Whose box this is: the mentor, bottom-left, in quiet grey. */}
          {(!heading || nudgeEl) && (
            <div className="flex items-center gap-3">
              {!heading && (
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Avatar
                    photoUrl={group.mentor.photoUrl}
                    name={fullName(group.mentor)}
                    size="xs"
                    userId={group.mentor.id}
                  />
                  {fullName(group.mentor)}
                </div>
              )}
              {nudgeEl}
            </div>
          )}
          </div>
          {showForms && (
            // Every action lives in this right-hand column; the left holds content only.
            <div className="shrink-0 self-stretch border-l border-os-container/60 pl-4">
              {(
                <WeekFormsCard
                  mentor={{
                    role: "mentor",
                    personId: group.mentor.id,
                    photoUrl: group.mentor.photoUrl,
                    personName: fullName(group.mentor),
                    formName: mentorSlot?.form?.name ?? null,
                    response: mentorSlot?.responses[group.mentor.id],
                  }}
                  mentees={group.rows.map((row) => {
                    const slot = formsFor(row.domainId)?.mentee;
                    return {
                      role: "mentee" as const,
                      personId: row.menteeId,
                      photoUrl: row.mentee.photoUrl,
                      personName: fullName(row.mentee),
                      formName: slot?.form?.name ?? null,
                      response: slot?.responses[row.menteeId],
                    };
                  })}
                />
              )}
            </div>
          )}
        </div>
      </div>
      <MentorNoteOverlay noteId={openNoteId} onClose={() => setOpenNoteId(null)} />
    </section>
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
  onOpenNote,
}: {
  cell: GridCell;
  row: GridMenteeRow;
  termId: string;
  highlightMissing: boolean;
  onOpenNote: (noteId: string) => void;
}) {
  const [busy, setBusy] = useState(false);

  const base =
    "inline-flex h-6 w-6 items-center justify-center rounded-full text-[10px] transition";

  // Submitted: open the existing note, colored by its vibe.
  if (cell.state === "submitted") {
    // A started note with no rating still reads as "not filled in". Under Core
    // oversight, flag it (amber dashed) like a missing cell so the grid matches
    // the "Not filled in" filter; otherwise it's a neutral gray dot.
    const cls = cell.vibe
      ? `${VIBE_META[cell.vibe].dot} text-white`
      : highlightMissing
      ? "border border-dashed border-os-amber text-os-amber"
      : "bg-muted-foreground/40 text-white";
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
    missing ? "bg-muted text-muted-foreground" : "border border-dashed border-border text-muted-foreground";
  const hover =
    "hover:bg-muted/60";

  // A non-mentor viewer has nothing to open.
  if (!cell.canCreate) {
    return (
      <Tooltip
        content={`Week ${cell.week} · ${missing ? "no note written yet" : "not yet due"}`}
      >
        <span className={`${base} ${style}`}>{missing ? "–" : ""}</span>
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
        className={`${base} ${style} ${hover}`}
      >
        <Plus className="h-3 w-3 text-foreground" aria-hidden />
        <span className="sr-only">Open note for week {cell.week}</span>
      </button>
    </Tooltip>
  );
}
