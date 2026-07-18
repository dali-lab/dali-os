import { Form, Link, redirect, useLoaderData, useSearchParams } from "react-router";
import type { Route } from "./+types/mentorship.browse";
import { requireAuth } from "~/lib/auth";
import { prisma } from "~/lib/db";
import { canViewMentorship } from "../lib/visibility";
import { isCore, currentTerm } from "~/lib/roles";
import { weekNumberInTerm, weekStartForNumber, weeksInTerm } from "../lib/week";
import { AreaPillNav } from "~/components/AreaPillNav";
import { mentorshipPills } from "../components/mentorshipPills";

export const meta: Route.MetaFunction = () => [
  { title: "Notes · DALI OS" },
];

// Surfaces the area subtab row (see layout.tsx's areaPills handling).
export const handle = { areaPills: true };

type Person = { id: string; firstName: string; lastName: string };

type NoteRow = {
  id: string;
  weekOf: string;
  // Week number within the note's term, computed from the term's start
  // (null if the note's term has no dates — shouldn't happen). Displayed as
  // "Week N" instead of the raw date.
  week: number | null;
  mentor: Person;
  mentee: Person;
  projectName: string;
  domainCode: string;
};

type MissingRow = {
  mentor: Person;
  mentee: Person;
  projectName: string;
  domainCode: string;
};

type FilterOption = { id: string; label: string };

type LoaderData = {
  filters: {
    mentorId: string;
    menteeId: string;
    projectId: string;
    domainId: string;
    termId: string;
    // Week number within the selected term ("" = any week). The date-based
    // weekOf is derived from this + the term's start server-side.
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
  notes: NoteRow[];
  missing: MissingRow[];
  isCore: boolean;
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

  // The selected term (defaulted to current) drives the week-number mapping:
  // Week N ↔ a Monday-UTC weekOf date relative to the term's start.
  const selectedTerm = terms.find((t) => t.id === filters.termId) ?? null;
  const selectedWeek = filters.week ? Number(filters.week) : null;
  const weekOfDate =
    selectedTerm && selectedWeek && Number.isFinite(selectedWeek)
      ? weekStartForNumber(selectedTerm.startDate, selectedWeek)
      : null;
  // id → term start, so each note's weekOf can be labelled "Week N".
  const termStartById = new Map(terms.map((t) => [t.id, t.startDate]));

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

  // Notes matching the filters (status=any or exists).
  const where: Record<string, unknown> = {};
  if (filters.mentorId) where.mentorId = filters.mentorId;
  if (filters.menteeId) where.menteeId = filters.menteeId;
  if (filters.projectId) where.projectId = filters.projectId;
  if (filters.domainId) where.domainId = filters.domainId;
  if (filters.termId) where.termId = filters.termId;
  if (weekOfDate) where.weekOf = weekOfDate;

  const notesRaw =
    status === "missing"
      ? []
      : await prisma.mentorNote.findMany({
          where,
          orderBy: [{ weekOf: "desc" }, { updatedAt: "desc" }],
          take: 200,
          select: {
            id: true,
            weekOf: true,
            termId: true,
            projectId: true,
            domainId: true,
            mentor: { select: { id: true, firstName: true, lastName: true } },
            mentee: { select: { id: true, firstName: true, lastName: true } },
          },
        });

  // Missing rows: for the selected term + weekOf, list pairs without notes.
  // Requires both termId and weekOf — otherwise it would be unbounded.
  let missing: MissingRow[] = [];
  if (status === "missing" && filters.termId && weekOfDate) {
    const weekOf = weekOfDate;
    const pairWhere: Record<string, unknown> = { termId: filters.termId };
    if (filters.mentorId) pairWhere.mentorUserId = filters.mentorId;
    if (filters.menteeId) pairWhere.menteeUserId = filters.menteeId;
    if (filters.projectId) pairWhere.projectId = filters.projectId;
    if (filters.domainId) pairWhere.domainId = filters.domainId;
    const pairs = await prisma.mentorshipPair.findMany({
      where: pairWhere,
      select: {
        mentorUserId: true,
        menteeUserId: true,
        projectId: true,
        domainId: true,
        mentor: { select: { id: true, firstName: true, lastName: true } },
        mentee: { select: { id: true, firstName: true, lastName: true } },
      },
    });
    const notes = await prisma.mentorNote.findMany({
      where: { termId: filters.termId, weekOf },
      select: {
        mentorId: true,
        menteeId: true,
        projectId: true,
        domainId: true,
      },
    });
    const haveKey = new Set(
      notes.map(
        (n) => `${n.mentorId}|${n.menteeId}|${n.projectId}|${n.domainId}`,
      ),
    );
    const missingPairs = pairs.filter(
      (p) =>
        !haveKey.has(
          `${p.mentorUserId}|${p.menteeUserId}|${p.projectId}|${p.domainId}`,
        ),
    );
    const projectIds = [...new Set(missingPairs.map((p) => p.projectId))];
    const domainIds = [...new Set(missingPairs.map((p) => p.domainId))];
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
    const pm = new Map(projects.map((p) => [p.id, p]));
    const dm = new Map(domains.map((d) => [d.id, d]));
    missing = missingPairs.map((p) => ({
      mentor: p.mentor,
      mentee: p.mentee,
      projectName: pm.get(p.projectId)?.name ?? "Unknown",
      domainCode: dm.get(p.domainId)?.code ?? "?",
    }));
  }

  // Denormalize for the existing-notes list.
  const noteProjectIds = [...new Set(notesRaw.map((n) => n.projectId))];
  const noteDomainIds = [...new Set(notesRaw.map((n) => n.domainId))];
  const [noteProjects, noteDomains] = await Promise.all([
    noteProjectIds.length
      ? prisma.project.findMany({
          where: { id: { in: noteProjectIds } },
          select: { id: true, name: true },
        })
      : Promise.resolve([] as { id: string; name: string }[]),
    noteDomainIds.length
      ? prisma.domain.findMany({
          where: { id: { in: noteDomainIds } },
          select: { id: true, code: true },
        })
      : Promise.resolve([] as { id: string; code: string }[]),
  ]);
  const npm = new Map(noteProjects.map((p) => [p.id, p]));
  const ndm = new Map(noteDomains.map((d) => [d.id, d]));
  const notes: NoteRow[] = notesRaw.map((n) => {
    // Label each note by its week number within its own term (not the filter's).
    // A note dated before its term's start yields a non-positive number that
    // reads as broken ("Week -10"); leave `week` null so it falls back to the
    // date label.
    const termStart = termStartById.get(n.termId);
    const wk = termStart ? weekNumberInTerm(n.weekOf, termStart) : null;
    return {
      id: n.id,
      weekOf: n.weekOf.toISOString(),
      week: wk != null && wk >= 1 ? wk : null,
      mentor: n.mentor,
      mentee: n.mentee,
      projectName: npm.get(n.projectId)?.name ?? "Unknown",
      domainCode: ndm.get(n.domainId)?.code ?? "?",
    };
  });

  const data: LoaderData = {
    filters,
    options,
    notes,
    missing,
    isCore: await isCore(auth.user.sub),
  };
  return data;
}

function fmt(d: string) {
  return new Date(d).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function fullName(u: Person) {
  return `${u.firstName} ${u.lastName}`.trim();
}

export default function MentorshipBrowse() {
  const data = useLoaderData() as LoaderData;
  const [params] = useSearchParams();

  return (
    <main className="flex flex-col gap-6">
      <AreaPillNav items={mentorshipPills({ isCore: data.isCore, active: "browse" })} />
      <header>
        <h1 className="font-heading text-2xl font-bold text-foreground">
          Mentorship notes
        </h1>
      </header>

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
            <option value="any">Any</option>
            <option value="exists">Exists</option>
            <option value="missing">Missing (needs term + week)</option>
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
              className="px-3 py-1.5 rounded-md border border-border text-sm text-muted-foreground hover:text-foreground"
            >
              Clear
            </Link>
          )}
        </div>
      </Form>

      {data.filters.status === "missing" ? (
        <section className="bg-card border border-border rounded-lg p-4 flex flex-col gap-3">
          <h2 className="font-heading font-semibold text-foreground">
            Missing notes
            {data.filters.termId && data.filters.week
              ? ` · Week ${data.filters.week}`
              : ""}
          </h2>
          {!data.filters.termId || !data.filters.week ? (
            <p className="text-sm text-muted-foreground">
              Pick both a term and a week to compute missing notes.
            </p>
          ) : data.missing.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No missing notes for the selected filters. Nice.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {data.missing.map((m, i) => (
                <li key={i} className="py-2 flex items-center justify-between">
                  <div className="flex flex-col">
                    <span className="font-medium text-foreground">
                      {fullName(m.mentor)} → {fullName(m.mentee)}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {m.projectName} · {m.domainCode}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : (
        <section className="bg-card border border-border rounded-lg p-4 flex flex-col gap-3">
          <h2 className="font-heading font-semibold text-foreground">
            Notes ({data.notes.length})
          </h2>
          {data.notes.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No notes match these filters.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {data.notes.map((n) => (
                <li
                  key={n.id}
                  className="py-2 flex items-center justify-between gap-3"
                >
                  <div className="flex flex-col">
                    <span className="font-medium text-foreground">
                      {fullName(n.mentor)} → {fullName(n.mentee)}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {n.projectName} · {n.domainCode} ·{" "}
                      {n.week != null ? `Week ${n.week}` : `week of ${fmt(n.weekOf)}`}
                    </span>
                  </div>
                  <Link
                    to={`/mentorship/notes/${n.id}`}
                    className="text-sm text-accent-coral hover:underline"
                  >
                    Open
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </main>
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
