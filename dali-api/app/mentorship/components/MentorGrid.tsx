import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { Plus } from "lucide-react";
import { Avatar } from "~/components/ui/Avatar";
import { VIBE_META } from "../lib/vibe";
import type {
  GridCell,
  GridMenteeRow,
  GridMentorGroup,
  GridPerson,
} from "../lib/mentor-grid.server";

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
}: {
  group: GridMentorGroup;
  weeks: number[];
  currentWeek: number | null;
  termId: string;
  highlightMissing: boolean;
  heading?: string;
}) {
  return (
    <section className="bg-card border border-border rounded-lg p-4 flex flex-col gap-3">
      <h2 className="font-heading font-semibold text-foreground flex items-center gap-2">
        {heading ?? (
          <>
            <Avatar
              photoUrl={group.mentor.photoUrl}
              name={fullName(group.mentor)}
              size="sm"
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
                  className={`w-9 text-center text-[11px] font-medium pb-1 ${
                    w === currentWeek ? "text-accent-coral" : "text-muted-foreground"
                  }`}
                  title={w === currentWeek ? `Week ${w} (current)` : `Week ${w}`}
                >
                  {w}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {group.rows.map((row) => (
              <tr key={row.key}>
                <td className="pr-3 whitespace-nowrap">
                  <span className="inline-flex items-center gap-2 align-middle">
                    <Avatar
                      photoUrl={row.mentee.photoUrl}
                      name={fullName(row.mentee)}
                      size="xs"
                    />
                    <span className="font-medium text-foreground">
                      {fullName(row.mentee)}
                    </span>
                  </span>{" "}
                  <span className="text-xs text-muted-foreground">
                    {row.projectName} · {row.domainCode}
                  </span>
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
    return (
      <Link
        to={`/mentorship/notes/${cell.noteId}`}
        title={`Week ${cell.week}${cell.vibe ? ` · ${VIBE_META[cell.vibe].label}` : " · no vibe"}`}
        className={`${base} ${swatch} text-white hover:ring-2 hover:ring-offset-1 hover:ring-border`}
      >
        <span className="sr-only">Open note</span>
      </Link>
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
      : "bg-muted text-muted-foreground/60";
  const hover =
    missing && highlightMissing ? "hover:bg-red-400/10" : "hover:bg-muted/60";

  // A non-mentor viewer has nothing to open.
  if (!cell.canCreate) {
    return (
      <span
        className={`${base} ${style}`}
        title={`Week ${cell.week} · ${missing ? "no note" : "not yet due"}`}
      >
        {missing ? "" : "–"}
      </span>
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
    <button
      type="button"
      onClick={openNote}
      disabled={busy}
      title={`Week ${cell.week} · open note`}
      className={`${base} ${style} ${hover}`}
    >
      <Plus className="h-3 w-3" aria-hidden />
      <span className="sr-only">Open note for week {cell.week}</span>
    </button>
  );
}
