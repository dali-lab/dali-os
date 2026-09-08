import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { Plus, Trash2 } from "lucide-react";
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

function fullName(u: GridPerson) {
  return `${u.firstName} ${u.lastName}`.trim();
}

// One mentor's card: their mentees down the rows, weeks across the columns.
// `heading` overrides the mentor's name (the hub shows a single group where the
// viewer is the mentor, so it labels the section "My mentees" instead).
// `highlightMissing` flags due-but-unwritten weeks in red — reserved for
// core/admin oversight; for a plain mentor the gaps read neutrally.
export function MentorGrid({
  group,
  weeks,
  currentWeek,
  termId,
  highlightMissing,
  heading,
  edit,
}: {
  group: GridMentorGroup;
  weeks: number[];
  currentWeek: number | null;
  termId: string;
  highlightMissing: boolean;
  heading?: string;
  edit?: MentorGridEdit;
}) {
  const { os, panel, panelPad, heading: headingClass } = useOsChrome();
  return (
    <section className={cn(panel, panelPad, "flex flex-col gap-3")}>
      <h2 className={headingClass}>
        {heading ?? (
          <>
            <Avatar
              photoUrl={group.mentor.photoUrl}
              name={fullName(group.mentor)}
              size={os ? "xs" : "sm"}
              userId={group.mentor.id}
            />
            {fullName(group.mentor)}
          </>
        )}
      </h2>
      <div className="overflow-x-auto">
        <table className="border-separate border-spacing-1 text-sm">
          <thead>
            <tr>
              <th className="text-left font-medium text-muted-foreground pr-3 pb-1">
                Mentee
              </th>
              {weeks.map((w) => (
                <th
                  key={w}
                  className={cn(
                    "w-9 text-center text-[11px] font-medium pb-1",
                    w === currentWeek
                      ? os
                        ? "text-os-accent"
                        : "text-accent-coral"
                      : "text-muted-foreground",
                  )}
                >
                  <Tooltip
                    content={w === currentWeek ? `Week ${w} (current term week)` : `Week ${w}`}
                  >
                    <span>{w}</span>
                  </Tooltip>
                </th>
              ))}
              {edit && (
                <th className="pl-3 text-left font-medium text-muted-foreground pb-1">
                  Mentor
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {group.rows.map((row) => (
              <tr key={row.key}>
                {/* Fixed-width identity cell: avatar left, name stacked over
                    project · domain. Stacking (not inline) keeps the name and
                    the project text starting at the same x on every row, so the
                    column reads as a column regardless of how long either is. */}
                <td className="pr-3 align-middle">
                  <div className="flex items-center gap-2 max-w-[16rem]">
                    <Avatar
                      photoUrl={row.mentee.photoUrl}
                      name={fullName(row.mentee)}
                      size="xs"
                    />
                    <div className="flex flex-col leading-tight min-w-0">
                      <span
                        className="font-medium text-foreground truncate"
                        title={fullName(row.mentee)}
                      >
                        {fullName(row.mentee)}
                      </span>
                      <span
                        className="text-xs text-muted-foreground truncate"
                        title={`${row.projectName} · ${row.domainCode}`}
                      >
                        {row.projectName} · {row.domainCode}
                      </span>
                    </div>
                  </div>
                </td>
                {row.cells.map((cell) => (
                  <td key={cell.week} className="text-center">
                    <GridCellView
                      cell={cell}
                      row={row}
                      termId={termId}
                      highlightMissing={highlightMissing}
                    />
                  </td>
                ))}
                {edit && (
                  <td className="pl-3 whitespace-nowrap">
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
                        className="text-muted-foreground hover:text-red-500 disabled:opacity-50"
                        title="Remove pairing"
                      >
                        <Trash2 className="w-4 h-4" aria-hidden />
                        <span className="sr-only">
                          Remove {fullName(row.mentee)} pairing
                        </span>
                      </button>
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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
}: {
  cell: GridCell;
  row: GridMenteeRow;
  termId: string;
  highlightMissing: boolean;
}) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);

  const base =
    "inline-flex h-6 w-6 items-center justify-center rounded-full text-[10px] transition";

  // Submitted: open the existing note, colored by its vibe.
  if (cell.state === "submitted") {
    const swatch = cell.vibe ? VIBE_META[cell.vibe].dot : "bg-muted-foreground/40";
    const vibeLabel = cell.vibe ? VIBE_META[cell.vibe].label : "no vibe set";
    const vibeDesc = cell.vibe === "Good"
      ? "Mentor marked this week as going well."
      : cell.vibe === "Ok"
      ? "Mentor flagged some areas to work on."
      : cell.vibe === "Bad"
      ? "Mentor flagged something concerning — follow up."
      : "No overall vibe was recorded for this week.";
    return (
      <Tooltip
        content={`Week ${cell.week} · ${vibeLabel}. ${vibeDesc}`}
        variant="rich"
      >
        <Link
          to={`/mentorship/notes/${cell.noteId}`}
          className={`${base} ${swatch} text-white hover:ring-2 hover:ring-offset-1 hover:ring-border`}
        >
          <span className="sr-only">Open note</span>
        </Link>
      </Tooltip>
    );
  }

  // No note yet. Missing weeks read red only under oversight; otherwise the gap
  // is a neutral, still-actionable slot.
  const missing = cell.state === "missing";
  const style =
    missing && highlightMissing
      ? "border border-dashed border-red-400 text-red-400"
      : missing
      ? "border border-dashed border-border text-muted-foreground"
      : "bg-muted text-muted-foreground";
  const hover =
    missing && highlightMissing ? "hover:bg-red-400/10" : "hover:bg-muted/60";

  // A non-mentor viewer has nothing to open.
  if (!cell.canCreate) {
    return (
      <Tooltip
        content={`Week ${cell.week} · ${missing ? "no note written yet" : "not yet due"}`}
      >
        <span className={`${base} ${style}`}>
          {missing ? "" : "–"}
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
      navigate(`/mentorship/notes/${id}`);
    } catch {
      setBusy(false);
    }
  }

  return (
    <Tooltip content={`Week ${cell.week} — click to open or create this week's note`}>
      <button
        type="button"
        onClick={openNote}
        disabled={busy}
        className={`${base} ${style} ${hover}`}
      >
        <Plus className="h-3 w-3" aria-hidden />
        <span className="sr-only">Open note for week {cell.week}</span>
      </button>
    </Tooltip>
  );
}
