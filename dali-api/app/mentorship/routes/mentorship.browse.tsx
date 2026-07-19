import { useEffect, useRef, useState } from "react";
import {
  Form,
  Link,
  redirect,
  useLoaderData,
  useNavigate,
  useSearchParams,
} from "react-router";
import { LayoutTemplate } from "lucide-react";
import type { Route } from "./+types/mentorship.browse";
import { requireAuth } from "~/lib/auth";
import { prisma } from "~/lib/db";
import {
  canViewMentorship,
  mentorNoteWhere,
  mentorshipPairWhere,
} from "../lib/visibility";
import { isCore, currentTerm } from "~/lib/roles";
import { AreaPillNav } from "~/components/AreaPillNav";
import { mentorshipPills } from "../components/mentorshipPills";
import { TemplatesModal } from "../components/TemplatesModal";
import { MentorGrid } from "../components/MentorGrid";
import {
  buildGrid,
  termWeekCount,
  type MentorGridResult,
} from "../lib/mentor-grid.server";

export const meta: Route.MetaFunction = () => [
  { title: "Notes · DALI OS" },
];

// Surfaces the area subtab row (see layout.tsx's areaPills handling).
export const handle = { areaPills: true };

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
  grid: MentorGridResult;
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
  };

  // Scope non-Core viewers to their own notes/pairs + own-domain mentee data.
  const [pairScope, noteScope] = await Promise.all([
    mentorshipPairWhere(auth.user.sub),
    mentorNoteWhere(auth.user.sub),
  ]);

  // Build pickers from people/projects/domains/terms touched by notes or
  // pairs. Skipping pure-lookup tables keeps the option lists short and
  // relevant — no Domain picker entries for domains never mentored.
  const [pairUsers, noteUsers, projectsWithPairs, domainsWithPairs, terms] =
    await Promise.all([
      prisma.mentorshipPair.findMany({
        where: pairScope,
        select: {
          mentor: { select: { id: true, firstName: true, lastName: true } },
          mentee: { select: { id: true, firstName: true, lastName: true } },
        },
      }),
      prisma.mentorNote.findMany({
        where: noteScope,
        select: {
          mentor: { select: { id: true, firstName: true, lastName: true } },
          mentee: { select: { id: true, firstName: true, lastName: true } },
        },
      }),
      prisma.project.findMany({
        where: { mentorshipPairs: { some: pairScope } },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      }),
      prisma.domain.findMany({
        where: { mentorshipPairs: { some: pairScope } },
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
      ? Array.from({ length: termWeekCount(selectedTerm.startDate, selectedTerm.endDate) }, (_, i) => ({
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
        pairScope,
        noteScope,
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
      <header className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="font-heading text-2xl font-bold text-foreground">
          Mentorship notes
        </h1>
        <div className="flex items-center gap-2 ml-auto">
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
          <select
            value={data.filters.termId}
            onChange={(e) => {
              const next = new URLSearchParams(params);
              next.set("termId", e.target.value);
              navigate(`/mentorship/browse?${next.toString()}`);
            }}
            aria-label="Filter by term"
            className="px-3 py-1.5 text-sm border border-border rounded-md bg-background text-foreground sm:w-40"
          >
            <option value="">Any term</option>
            {data.options.terms.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </header>

      {data.isCore && (
        <TemplatesModal
          open={templatesOpen}
          onClose={() => setTemplatesOpen(false)}
        />
      )}

      <Form
        method="get"
        className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm"
      >
        {/* Keep the header term when applying secondary filters. */}
        <input type="hidden" name="termId" value={data.filters.termId} />
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
          name="week"
          label="Week"
          options={data.options.weeks}
          value={data.filters.week}
        />
        <div className="ml-auto flex items-center gap-2">
          <button
            type="submit"
            className="px-3 py-1 rounded-md bg-accent-coral text-white text-sm hover:opacity-90"
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
              className="px-3 py-1 rounded-md border border-border text-sm text-muted-foreground hover:text-foreground"
            >
              Clear
            </Link>
          )}
        </div>
      </Form>

      {!data.grid.termSelected ? (
        <EmptyState>Pick a term to see the weekly mentorship grid.</EmptyState>
      ) : data.grid.mentors.length === 0 ? (
        <EmptyState>No mentorship pairs match these filters.</EmptyState>
      ) : (
        data.grid.mentors.map((group) => (
          <MentorGrid
            key={group.mentor.id}
            group={group}
            weeks={data.grid.weeks}
            currentWeek={data.grid.currentWeek}
            termId={data.filters.termId}
            highlightMissing={data.isCore}
          />
        ))
      )}
    </main>
  );
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <section className="bg-card border border-border rounded-lg p-4">
      <p className="text-sm text-muted-foreground">{children}</p>
    </section>
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
    <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      {label}
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
