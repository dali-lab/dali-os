import { useEffect, useRef, useState } from "react";
import {
  Form,
  Link,
  redirect,
  useLoaderData,
  useNavigate,
  useSearchParams,
} from "react-router";
import { LayoutTemplate, Plus } from "lucide-react";
import type { Route } from "./+types/mentorship.browse";
import { requireAuth } from "~/lib/auth";
import { prisma } from "~/lib/db";
import { canViewMentorship } from "../lib/visibility";
import { isCore, currentTerm } from "~/lib/roles";
import { weekNumberInTerm, weekStartForNumber, weeksInTerm } from "../lib/week";
import { AreaPillNav } from "~/components/AreaPillNav";
import { mentorshipPills } from "../components/mentorshipPills";
import { TemplatesModal } from "../components/TemplatesModal";
import { VIBE_META, type Vibe } from "../lib/vibe";

export const meta: Route.MetaFunction = () => [
  { title: "Notes · DALI OS" },
];

// Surfaces the area subtab row (see layout.tsx's areaPills handling).
export const handle = { areaPills: true };

type Person = { id: string; firstName: string; lastName: string };

// One week's status for a pair. `submitted` = a note exists (with its vibe);
// `missing` = a due week with no note; `future` = a week not yet due.
type Cell = {
  week: number;
  // Monday-UTC ISO date for this week, so the client can create a note for it.
  weekOfIso: string;
  state: "submitted" | "missing" | "future";
  noteId: string | null;
  vibe: Vibe | null;
  // The viewer is this pair's mentor and the week is due but has no note yet —
  // clicking the cell opens (creates) the note.
  canCreate: boolean;
};

type MenteeRow = {
  key: string;
  mentee: Person;
  menteeId: string;
  projectId: string;
  domainId: string;
  projectName: string;
  domainCode: string;
  cells: Cell[];
};

type MentorGroup = {
  mentor: Person;
  rows: MenteeRow[];
};

type FilterOption = { id: string; label: string };

type LoaderData = {
  filters: {
    mentorId: string;
    menteeId: string;
    projectId: string;
    domainId: string;
    termId: string;
    // Week number within the selected term ("" = any week). When set, the grid
    // shows only that week's column.
    week: string;
    status: "any" | "exists" | "missing";
  };
  options: {
    mentors: FilterOption[];
    mentees: FilterOption[];
    projects: FilterOption[];
    domains: FilterOption[];
    terms: FilterOption[];
    // Week 1..N for the selected term (empty when no term is selected).
    weeks: FilterOption[];
  };
  grid: {
    // Week numbers shown as columns (all weeks, or a single filtered week).
    weeks: number[];
    // The term's current week (0 = not started, weeksCount = ended).
    currentWeek: number | null;
    mentors: MentorGroup[];
    // False when no term is selected — the grid has no week axis then.
    termSelected: boolean;
  };
  isCore: boolean;
  viewerId: string;
};

function pickFilter(value: string | null): string {
  return value ?? "";
}

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");
  if (auth.user.type === "applicant") return redirect("/portal");
  if (!(await canViewMentorship(auth.user.sub))) {
    throw new Response("Forbidden", { status: 403 });
  }

  const url = new URL(request.url);
  const status =
    (url.searchParams.get("status") as LoaderData["filters"]["status"] | null) ??
    "any";
  // Term defaults to the current term when the URL doesn't pin one (first load).
  // An explicit `termId=` (the "Any" option) clears it back to unfiltered.
  const termParam = url.searchParams.get("termId");
  const defaultTerm = termParam === null ? await currentTerm() : null;
  const filters = {
    mentorId: pickFilter(url.searchParams.get("mentorId")),
    menteeId: pickFilter(url.searchParams.get("menteeId")),
    projectId: pickFilter(url.searchParams.get("projectId")),
    domainId: pickFilter(url.searchParams.get("domainId")),
    termId: termParam !== null ? termParam : defaultTerm?.id ?? "",
    week: pickFilter(url.searchParams.get("week")),
    status,
  };

  // Build pickers from people/projects/domains/terms touched by notes or
  // pairs. Skipping pure-lookup tables keeps the option lists short and
  // relevant — no Domain picker entries for domains never mentored.
  const [pairUsers, noteUsers, projectsWithPairs, domainsWithPairs, terms] =
    await Promise.all([
      prisma.mentorshipPair.findMany({
        select: {
          mentor: { select: { id: true, firstName: true, lastName: true } },
          mentee: { select: { id: true, firstName: true, lastName: true } },
        },
      }),
      prisma.mentorNote.findMany({
        select: {
          mentor: { select: { id: true, firstName: true, lastName: true } },
          mentee: { select: { id: true, firstName: true, lastName: true } },
        },
      }),
      prisma.project.findMany({
        where: { mentorshipPairs: { some: {} } },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      }),
      prisma.domain.findMany({
        where: { mentorshipPairs: { some: {} } },
        select: { id: true, code: true, displayName: true },
        orderBy: { code: "asc" },
      }),
      prisma.term.findMany({
        orderBy: { sortKey: "desc" },
        select: { id: true, code: true, startDate: true, endDate: true },
      }),
    ]);

  // The selected term (defaulted to current) drives the grid's week axis.
  const selectedTerm = terms.find((t) => t.id === filters.termId) ?? null;
  const selectedWeek = filters.week ? Number(filters.week) : null;

  function uniquePeople(
    ...lists: { id: string; firstName: string; lastName: string }[][]
  ): FilterOption[] {
    const map = new Map<string, FilterOption>();
    for (const list of lists) {
      for (const p of list) {
        if (!map.has(p.id)) {
          map.set(p.id, {
            id: p.id,
            label: `${p.firstName} ${p.lastName}`.trim(),
          });
        }
      }
    }
    return [...map.values()].sort((a, b) => a.label.localeCompare(b.label));
  }

  const mentors = uniquePeople(
    pairUsers.map((p) => p.mentor),
    noteUsers.map((n) => n.mentor),
  );
  const mentees = uniquePeople(
    pairUsers.map((p) => p.mentee),
    noteUsers.map((n) => n.mentee),
  );
  const options = {
    mentors,
    mentees,
    projects: projectsWithPairs.map((p) => ({ id: p.id, label: p.name })),
    domains: domainsWithPairs.map((d) => ({
      id: d.id,
      label: `${d.displayName} (${d.code})`,
    })),
    terms: terms.map((t) => ({ id: t.id, label: t.code })),
    // Week 1..N of the selected term. Empty when no term is selected (week
    // numbering has no origin then).
    weeks: selectedTerm
      ? Array.from({ length: weeksInTerm(selectedTerm.startDate, selectedTerm.endDate) }, (_, i) => ({
          id: String(i + 1),
          label: `Week ${i + 1}`,
        }))
      : [],
  };

  // The grid is a mentor → mentees → weeks matrix, scoped to one term. Without
  // a selected term there's no week axis, so we render an empty-state prompt.
  const grid: LoaderData["grid"] = selectedTerm
    ? await buildGrid({
        term: selectedTerm,
        filters,
        weekFilter: selectedWeek,
        viewerId: auth.user.sub,
        onlyMissing: status === "missing",
      })
    : { weeks: [], currentWeek: null, mentors: [], termSelected: false };

  const data: LoaderData = {
    filters,
    options,
    grid,
    isCore: await isCore(auth.user.sub),
    viewerId: auth.user.sub,
  };
  return data;
}

// Builds the term's mentor → mentee → week matrix. Each pair (mentor, mentee,
// project, domain) is one row; each shown week is one cell that is either a
// submitted note (with its vibe), a missing note (a due week with no note), or
// a future week (not yet due). Weeks past `currentWeek` are future; the rest
// are due. `onlyMissing` prunes to mentors/rows that owe at least one note.
async function buildGrid({
  term,
  filters,
  weekFilter,
  viewerId,
  onlyMissing,
}: {
  term: { id: string; startDate: Date; endDate: Date };
  filters: LoaderData["filters"];
  weekFilter: number | null;
  viewerId: string;
  onlyMissing: boolean;
}): Promise<LoaderData["grid"]> {
  const weeksCount = weeksInTerm(term.startDate, term.endDate);
  // Which week we're in now, clamped to [0, weeksCount]: 0 = term hasn't started
  // (everything future), weeksCount = term is over (everything due).
  const rawCurrent = weekNumberInTerm(new Date(), term.startDate);
  const currentWeek = Math.max(0, Math.min(weeksCount, rawCurrent));

  // Columns: a single week when the Week filter is set, else 1..weeksCount.
  const weeks =
    weekFilter && weekFilter >= 1 && weekFilter <= weeksCount
      ? [weekFilter]
      : Array.from({ length: weeksCount }, (_, i) => i + 1);

  const pairWhere: Record<string, unknown> = { termId: term.id };
  if (filters.mentorId) pairWhere.mentorUserId = filters.mentorId;
  if (filters.menteeId) pairWhere.menteeUserId = filters.menteeId;
  if (filters.projectId) pairWhere.projectId = filters.projectId;
  if (filters.domainId) pairWhere.domainId = filters.domainId;

  const noteWhere: Record<string, unknown> = { termId: term.id };
  if (filters.mentorId) noteWhere.mentorId = filters.mentorId;
  if (filters.menteeId) noteWhere.menteeId = filters.menteeId;
  if (filters.projectId) noteWhere.projectId = filters.projectId;
  if (filters.domainId) noteWhere.domainId = filters.domainId;

  const [pairs, notes] = await Promise.all([
    prisma.mentorshipPair.findMany({
      where: pairWhere,
      select: {
        mentorUserId: true,
        menteeUserId: true,
        projectId: true,
        domainId: true,
        mentor: { select: { id: true, firstName: true, lastName: true } },
        mentee: { select: { id: true, firstName: true, lastName: true } },
      },
    }),
    prisma.mentorNote.findMany({
      where: noteWhere,
      select: {
        id: true,
        mentorId: true,
        menteeId: true,
        projectId: true,
        domainId: true,
        weekOf: true,
        vibe: true,
      },
    }),
  ]);

  // Denormalize project names + domain codes for the pair rows.
  const projectIds = [...new Set(pairs.map((p) => p.projectId))];
  const domainIds = [...new Set(pairs.map((p) => p.domainId))];
  const [projects, domains] = await Promise.all([
    prisma.project.findMany({
      where: { id: { in: projectIds } },
      select: { id: true, name: true },
    }),
    prisma.domain.findMany({
      where: { id: { in: domainIds } },
      select: { id: true, code: true },
    }),
  ]);
  const pm = new Map(projects.map((p) => [p.id, p.name]));
  const dm = new Map(domains.map((d) => [d.id, d.code]));

  // Note lookup keyed by pair identity + week number.
  const noteByKey = new Map<string, { id: string; vibe: Vibe | null }>();
  for (const n of notes) {
    const wk = weekNumberInTerm(n.weekOf, term.startDate);
    noteByKey.set(
      `${n.mentorId}|${n.menteeId}|${n.projectId}|${n.domainId}|${wk}`,
      { id: n.id, vibe: n.vibe as Vibe | null },
    );
  }

  // Group pairs by mentor.
  const byMentor = new Map<string, MentorGroup>();
  for (const p of pairs) {
    let group = byMentor.get(p.mentorUserId);
    if (!group) {
      group = { mentor: p.mentor, rows: [] };
      byMentor.set(p.mentorUserId, group);
    }
    const cells: Cell[] = weeks.map((week) => {
      const weekOfIso = weekStartForNumber(term.startDate, week).toISOString();
      const note = noteByKey.get(
        `${p.mentorUserId}|${p.menteeUserId}|${p.projectId}|${p.domainId}|${week}`,
      );
      if (note) {
        return { week, weekOfIso, state: "submitted", noteId: note.id, vibe: note.vibe, canCreate: false };
      }
      const future = week > currentWeek;
      return {
        week,
        weekOfIso,
        state: future ? "future" : "missing",
        noteId: null,
        vibe: null,
        // Only the pair's mentor can start a note, and only for a due week.
        canCreate: !future && p.mentorUserId === viewerId,
      };
    });
    group.rows.push({
      key: `${p.mentorUserId}|${p.menteeUserId}|${p.projectId}|${p.domainId}`,
      mentee: p.mentee,
      menteeId: p.menteeUserId,
      projectId: p.projectId,
      domainId: p.domainId,
      projectName: pm.get(p.projectId) ?? "Unknown",
      domainCode: dm.get(p.domainId) ?? "?",
      cells,
    });
  }

  let mentors = [...byMentor.values()];
  if (onlyMissing) {
    // Keep only rows that owe a note, and mentors that still have such rows.
    for (const g of mentors) {
      g.rows = g.rows.filter((r) => r.cells.some((c) => c.state === "missing"));
    }
    mentors = mentors.filter((g) => g.rows.length > 0);
  }

  // Stable ordering: mentors by name, rows by mentee name then domain.
  const name = (u: Person) => `${u.firstName} ${u.lastName}`.trim().toLowerCase();
  mentors.sort((a, b) => name(a.mentor).localeCompare(name(b.mentor)));
  for (const g of mentors) {
    g.rows.sort(
      (a, b) =>
        name(a.mentee).localeCompare(name(b.mentee)) ||
        a.domainCode.localeCompare(b.domainCode),
    );
  }

  return { weeks, currentWeek, mentors, termSelected: true };
}

function fullName(u: Person) {
  return `${u.firstName} ${u.lastName}`.trim();
}

const FILTERS_STORAGE_KEY = "mentorship.browse.filters";

export default function MentorshipBrowse() {
  const data = useLoaderData() as LoaderData;
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const restored = useRef(false);

  // Remember the last-applied filter query and restore it on a fresh visit (no
  // filter params). Running once guards against clobbering an explicit "Clear".
  // `embed` is a dev-preview marker, not a filter — ignore it either way.
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    if (typeof window === "undefined") return;
    const current = new URLSearchParams(window.location.search);
    current.delete("embed");
    if ([...current].length === 0) {
      const saved = window.localStorage.getItem(FILTERS_STORAGE_KEY);
      if (saved) navigate(`/mentorship/browse?${saved}`, { replace: true });
    }
  }, [navigate]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const sp = new URLSearchParams(params);
    sp.delete("embed");
    const search = sp.toString();
    if (search) window.localStorage.setItem(FILTERS_STORAGE_KEY, search);
  }, [params]);

  return (
    <main className="flex flex-col gap-6">
      <AreaPillNav items={mentorshipPills({ active: "browse" })} />
      <header className="flex items-center justify-between gap-3">
        <h1 className="font-heading text-2xl font-bold text-foreground">
          Mentorship notes
        </h1>
        {data.isCore && (
          <button
            type="button"
            onClick={() => setTemplatesOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border text-sm text-foreground hover:bg-muted"
          >
            <LayoutTemplate className="w-4 h-4 text-accent-coral" aria-hidden />
            Templates
          </button>
        )}
      </header>

      {data.isCore && (
        <TemplatesModal
          open={templatesOpen}
          onClose={() => setTemplatesOpen(false)}
        />
      )}

      <Form
        method="get"
        className="bg-card border border-border rounded-lg p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3"
      >
        <FilterSelect
          name="mentorId"
          label="Mentor"
          options={data.options.mentors}
          value={data.filters.mentorId}
        />
        <FilterSelect
          name="menteeId"
          label="Mentee"
          options={data.options.mentees}
          value={data.filters.menteeId}
        />
        <FilterSelect
          name="projectId"
          label="Project"
          options={data.options.projects}
          value={data.filters.projectId}
        />
        <FilterSelect
          name="domainId"
          label="Domain"
          options={data.options.domains}
          value={data.filters.domainId}
        />
        <FilterSelect
          name="termId"
          label="Term"
          options={data.options.terms}
          value={data.filters.termId}
        />
        <FilterSelect
          name="week"
          label="Week"
          options={data.options.weeks}
          value={data.filters.week}
        />
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">Status</span>
          <select
            name="status"
            defaultValue={data.filters.status}
            className="rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground"
          >
            <option value="any">All weeks</option>
            <option value="missing">Only owed notes</option>
          </select>
        </label>
        <div className="flex items-end gap-2">
          <button
            type="submit"
            className="px-3 py-1.5 rounded-md bg-accent-coral text-white text-sm hover:opacity-90"
          >
            Apply
          </button>
          {params.toString() && (
            <Link
              to="/mentorship/browse"
              onClick={() => {
                if (typeof window !== "undefined") {
                  window.localStorage.removeItem(FILTERS_STORAGE_KEY);
                }
              }}
              className="px-3 py-1.5 rounded-md border border-border text-sm text-muted-foreground hover:text-foreground"
            >
              Clear
            </Link>
          )}
        </div>
      </Form>

      <Legend />

      {!data.grid.termSelected ? (
        <EmptyState>Pick a term to see the weekly mentorship grid.</EmptyState>
      ) : data.grid.mentors.length === 0 ? (
        <EmptyState>
          {data.filters.status === "missing"
            ? "No mentor owes a note for these filters. Nice."
            : "No mentorship pairs match these filters."}
        </EmptyState>
      ) : (
        data.grid.mentors.map((group) => (
          <MentorGrid
            key={group.mentor.id}
            group={group}
            weeks={data.grid.weeks}
            currentWeek={data.grid.currentWeek}
            termId={data.filters.termId}
          />
        ))
      )}
    </main>
  );
}

// The vibe/state key so cell colors are legible at a glance.
function Legend() {
  const items: { swatch: string; label: string }[] = [
    { swatch: `${VIBE_META.Good.dot}`, label: "Good" },
    { swatch: `${VIBE_META.Ok.dot}`, label: "So-so" },
    { swatch: `${VIBE_META.Bad.dot}`, label: "Bad" },
    { swatch: "bg-muted-foreground/40", label: "Submitted (no vibe)" },
    { swatch: "border border-red-400 border-dashed bg-transparent", label: "Missing" },
    { swatch: "bg-muted", label: "Future" },
  ];
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
      {items.map((it) => (
        <span key={it.label} className="inline-flex items-center gap-1.5">
          <span className={`inline-block h-3 w-3 rounded-full ${it.swatch}`} />
          {it.label}
        </span>
      ))}
    </div>
  );
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <section className="bg-card border border-border rounded-lg p-4">
      <p className="text-sm text-muted-foreground">{children}</p>
    </section>
  );
}

// One mentor's card: their mentees down the rows, weeks across the columns.
function MentorGrid({
  group,
  weeks,
  currentWeek,
  termId,
}: {
  group: MentorGroup;
  weeks: number[];
  currentWeek: number | null;
  termId: string;
}) {
  return (
    <section className="bg-card border border-border rounded-lg p-4 flex flex-col gap-3">
      <h2 className="font-heading font-semibold text-foreground">
        {fullName(group.mentor)}
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
                  <span className="font-medium text-foreground">
                    {fullName(row.mentee)}
                  </span>{" "}
                  <span className="text-xs text-muted-foreground">
                    {row.projectName} · {row.domainCode}
                  </span>
                </td>
                {row.cells.map((cell) => (
                  <td key={cell.week} className="text-center">
                    <GridCell cell={cell} row={row} termId={termId} />
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
// missing note (dashed red; clickable to create if the viewer is the mentor),
// or a future week (muted, inert).
function GridCell({
  cell,
  row,
  termId,
}: {
  cell: Cell;
  row: MenteeRow;
  termId: string;
}) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);

  const base =
    "inline-flex h-6 w-6 items-center justify-center rounded-full text-[10px] transition";

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

  if (cell.state === "future") {
    return (
      <span
        className={`${base} bg-muted text-muted-foreground/60`}
        title={`Week ${cell.week} · not yet due`}
      >
        –
      </span>
    );
  }

  // Missing: mentor can create; others just see the gap.
  if (!cell.canCreate) {
    return (
      <span
        className={`${base} border border-dashed border-red-400 text-red-400`}
        title={`Week ${cell.week} · no note`}
      />
    );
  }

  async function createNote() {
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
      onClick={createNote}
      disabled={busy}
      title={`Week ${cell.week} · start note`}
      className={`${base} border border-dashed border-red-400 text-red-400 hover:bg-red-400/10`}
    >
      <Plus className="h-3 w-3" aria-hidden />
      <span className="sr-only">Start note for week {cell.week}</span>
    </button>
  );
}

function FilterSelect({
  name,
  label,
  options,
  value,
}: {
  name: string;
  label: string;
  options: FilterOption[];
  value: string;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <select
        name={name}
        defaultValue={value}
        className="rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground"
      >
        <option value="">Any</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
