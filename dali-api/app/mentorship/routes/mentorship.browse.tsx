import { useEffect, useMemo, useRef, useState } from "react";
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
import { redirectToLogin } from "~/lib/login-next";
import { prisma } from "~/lib/db";
import { parseSessionCookie } from "~/lib/cookies";
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
import { EmptyState } from "../components/EmptyState";
import { Select } from "~/components/ui/floating";
import { SearchInput } from "~/components/ui/SearchInput";
import { filterPillClass } from "~/components/ui/floating/styles";
import { useOsChrome } from "~/components/os-chrome";
import { cn } from "~/lib/cn";
import {
  buildGrid,
  type MentorGridResult,
} from "../lib/mentor-grid.server";
import { VIBES, VIBE_META } from "../lib/vibe";

export const meta: Route.MetaFunction = () => [
  { title: "Notes · DALI OS" },
];

// Surfaces the area subtab row (see layout.tsx's areaPills handling).
export const handle = { areaPills: true };

type FilterOption = { id: string; label: string };

type LoaderData = {
  filters: {
    // Free-text people search, matched against the mentor and the mentee of
    // every row. Seeded from the URL; typing filters in the browser.
    query: string;
    projectId: string;
    domainId: string;
    termId: string;
    // Vibe ("" = any). When set, only mentee rows with at least one weekly
    // note of this vibe are shown.
    status: string;
  };
  options: {
    projects: FilterOption[];
    domains: FilterOption[];
    terms: FilterOption[];
    // Vibe filter options (Good / Ok / Bad with user-facing labels).
    statuses: FilterOption[];
  };
  grid: MentorGridResult;
  isCore: boolean;
  viewerId: string;
  collabToken: string | null;
  userName: string;
};

function pickFilter(value: string | null): string {
  return value ?? "";
}

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  if (auth.user.type === "applicant") return redirect("/portal");
  if (!(await canViewMentorship(auth.user.sub))) {
    throw new Response("Forbidden", { status: 403 });
  }

  const url = new URL(request.url);
  // Term defaults to the current term when the URL doesn't pin one (first load).
  // An explicit `termId=` (the "Any" option) clears it back to unfiltered.
  const termParam = url.searchParams.get("termId");
  const current = await currentTerm(request);
  const defaultTerm = termParam === null ? current : null;
  // A person search used to be two id-valued pickers, and the Members profile
  // still links here with ?menteeId=<id>. Both id params are accepted as a
  // seed for the search box so those links keep landing on the right person.
  const seedId =
    url.searchParams.get("menteeId") ?? url.searchParams.get("mentorId");
  const seeded = seedId
    ? await prisma.user.findUnique({
        where: { id: seedId },
        select: { firstName: true, lastName: true },
      })
    : null;

  const filters = {
    query:
      url.searchParams.get("q") ??
      (seeded ? `${seeded.firstName} ${seeded.lastName}`.trim() : ""),
    projectId: pickFilter(url.searchParams.get("projectId")),
    domainId: pickFilter(url.searchParams.get("domainId")),
    termId: termParam !== null ? termParam : defaultTerm?.id ?? "",
    status: pickFilter(url.searchParams.get("status")),
  };

  // Scope non-Core viewers to their own notes/pairs + own-domain mentee data.
  const [pairScope, noteScope] = await Promise.all([
    mentorshipPairWhere(auth.user.sub),
    mentorNoteWhere(auth.user.sub),
  ]);

  // Build pickers from projects/domains/terms touched by pairs. Skipping
  // pure-lookup tables keeps the option lists short and relevant — no Domain
  // picker entries for domains never mentored. People need no list: the search
  // box reads the names off the grid it is filtering.
  const [projectsWithPairs, domainsWithPairs, terms] =
    await Promise.all([
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

  const options = {
    projects: projectsWithPairs.map((p) => ({ id: p.id, label: p.name })),
    domains: domainsWithPairs.map((d) => ({
      id: d.id,
      label: `${d.displayName} (${d.code})`,
    })),
    // Mentorship keeps its own single-term grid + "Any term" escape hatch (the
    // grid's week axis needs exactly one term), so it isn't the shared
    // TermFilter — but it labels the current term the same way for consistency.
    terms: terms.map((t) => ({
      id: t.id,
      label: t.id === current?.id ? `${t.code} · current` : t.code,
    })),
    // Vibe filter options — the note's at-a-glance status.
    statuses: VIBES.map((v) => ({ id: v, label: VIBE_META[v].label })),
  };

  // The grid is a mentor → mentees → weeks matrix, scoped to one term. Without
  // a selected term there's no week axis, so we render an empty-state prompt.
  let grid: LoaderData["grid"] = selectedTerm
    ? await buildGrid({
        term: selectedTerm,
        filters,
        viewerId: auth.user.sub,
        pairScope,
        noteScope,
      })
    : { weeks: [], currentWeek: null, mentors: [], termSelected: false };

  // Status (vibe) filter: keep only mentee rows with at least one weekly note
  // of the selected vibe, and drop mentors left with no matching rows.
  if (filters.status) {
    grid = {
      ...grid,
      mentors: grid.mentors
        .map((m) => ({
          ...m,
          rows: m.rows.filter((r) =>
            r.cells.some((c) => c.vibe === filters.status),
          ),
        }))
        .filter((m) => m.rows.length > 0),
    };
  }

  const me = await prisma.user.findUnique({
    where: { id: auth.user.sub },
    select: { firstName: true, lastName: true },
  });

  const data: LoaderData = {
    filters,
    options,
    grid,
    isCore: await isCore(auth.user.sub),
    viewerId: auth.user.sub,
    collabToken: parseSessionCookie(request),
    userName: [me?.firstName, me?.lastName].filter(Boolean).join(" ") || "Core",
  };
  return data;
}


const FILTERS_STORAGE_KEY = "mentorship.browse.filters";

function nameOf(p: { firstName: string; lastName: string }) {
  return `${p.firstName} ${p.lastName}`.trim().toLowerCase();
}

// One search box across both sides of a pairing: a hit on the mentor keeps the
// whole group (all of their mentees), a hit on a mentee keeps just that row.
// Matching runs here rather than in the loader because the grid already holds
// every row the viewer may see, so the results land without a round trip.
function searchGrid(
  mentors: MentorGridResult["mentors"],
  query: string,
): MentorGridResult["mentors"] {
  const q = query.trim().toLowerCase();
  if (!q) return mentors;
  return mentors
    .map((m) =>
      nameOf(m.mentor).includes(q)
        ? m
        : { ...m, rows: m.rows.filter((r) => nameOf(r.mentee).includes(q)) },
    )
    .filter((m) => m.rows.length > 0);
}

export default function MentorshipBrowse() {
  const data = useLoaderData() as LoaderData;
  const { os, pageTitle } = useOsChrome();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [query, setQuery] = useState(data.filters.query);
  const restored = useRef(false);

  // `q` only enters the URL on Apply / Clear / a deep link, so re-syncing on
  // its value can't fight the keystrokes it isn't recording.
  useEffect(() => setQuery(data.filters.query), [data.filters.query]);

  const groups = useMemo(
    () => searchGrid(data.grid.mentors, query),
    [data.grid.mentors, query],
  );

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
        <h1 className={pageTitle}>Mentorship notes</h1>
        <div className="flex items-center gap-2 ml-auto">
          {data.isCore && (
            <button
              type="button"
              onClick={() => setTemplatesOpen(true)}
              className={
                os
                  ? "os-edit-btn"
                  : "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border text-sm text-foreground hover:bg-muted"
              }
            >
              <LayoutTemplate
                className={cn("w-4 h-4", os ? "text-os-grey" : "text-accent-coral")}
                aria-hidden
              />
              Templates
            </button>
          )}
          <Select
            ariaLabel="Filter by term"
            value={data.filters.termId}
            onChange={(v) => {
              const next = new URLSearchParams(params);
              next.set("termId", v);
              navigate(`/mentorship/browse?${next.toString()}`);
            }}
            options={[
              { value: "", label: "Any term" },
              ...data.options.terms.map((o) => ({ value: o.id, label: o.label })),
            ]}
            buttonClassName={cn(filterPillClass(os), "sm:w-40")}
          />
        </div>
      </header>

      {data.isCore && (
        <TemplatesModal
          open={templatesOpen}
          onClose={() => setTemplatesOpen(false)}
          collabToken={data.collabToken}
          userName={data.userName}
        />
      )}

      <SearchInput
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search mentors and mentees…"
        aria-label="Search mentors and mentees"
        containerClassName="sm:max-w-sm"
      />

      <Form
        method="get"
        className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm"
      >
        {/* Keep the header term and the live search when applying secondary
            filters — neither is a field of this form. */}
        <input type="hidden" name="termId" value={data.filters.termId} />
        <input type="hidden" name="q" value={query} />
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
          name="status"
          label="Status"
          options={data.options.statuses}
          value={data.filters.status}
        />
        <div className="ml-auto flex items-center gap-2">
          <button
            type="submit"
            className={
              os
                ? "os-btn-primary"
                : "px-3 py-1 rounded-md bg-accent-coral text-white text-sm hover:opacity-90"
            }
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
              className={
                os
                  ? "os-btn-ghost"
                  : "px-3 py-1 rounded-md border border-border text-sm text-muted-foreground hover:text-foreground"
              }
            >
              Clear
            </Link>
          )}
        </div>
      </Form>

      {!data.grid.termSelected ? (
        <EmptyState>Pick a term to see the weekly mentorship grid.</EmptyState>
      ) : groups.length === 0 ? (
        <EmptyState>
          {data.grid.mentors.length > 0
            ? `No mentors or mentees match "${query.trim()}".`
            : "No mentorship pairs match these filters."}
        </EmptyState>
      ) : (
        groups.map((group) => (
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
  const { os, bodyText } = useOsChrome();
  return (
    <label className={cn("inline-flex items-center gap-1.5", bodyText)}>
      {label}
      <Select
        name={name}
        defaultValue={value}
        options={[
          { value: "", label: "Any" },
          ...options.map((o) => ({ value: o.id, label: o.label })),
        ]}
        buttonClassName={filterPillClass(os)}
      />
    </label>
  );
}
