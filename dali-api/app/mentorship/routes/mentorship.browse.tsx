import { useEffect, useMemo, useRef, useState } from "react";
import {
  redirect,
  useLoaderData,
  useNavigate,
  useSearchParams,
} from "react-router";
import {
  Activity,
  FolderKanban,
  Layers,
  LayoutTemplate,
  Link2,
  Send,
} from "lucide-react";
import type { Route } from "./+types/mentorship.browse";
import { requireAuth, isNonMember } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { prisma } from "~/lib/db.server";
import { getCollabToken } from "~/lib/collab-token.server";
import {
  canViewMentorship,
  mentorNoteWhere,
  mentorshipPairWhere,
} from "../lib/visibility";
import { isCore, currentTerm } from "~/lib/roles";
import { TemplatesModal } from "../components/TemplatesModal";
import { NudgeModal } from "../components/NudgeModal";
import { MentorGrid } from "../components/MentorGrid";
import { EmptyState } from "../components/EmptyState";
import { Select, Tooltip } from "~/components/ui/floating";
import { SearchInput } from "~/components/ui/SearchInput";
import { filterPillClass } from "~/components/ui/floating/styles";
import { useOsChrome } from "~/components/os-chrome";
import { useToast } from "~/components/ui/toast";
import { cn } from "~/lib/cn";
import { buildGrid, type MentorGridResult } from "../lib/mentor-grid.server";
import { isUnfilled } from "../lib/grid-cell";
import {
  ColumnFilters,
  useColumnFilters,
  type FilterColumn,
} from "~/projects/components/ColumnFilters";
import type { ColumnFilter, FilterCells } from "~/projects/lib/submission-filters";
import { VIBES, VIBE_META, type Vibe } from "../lib/vibe";
import { isTermFormRole, type TermForms } from "../lib/term-forms";
import { loadTermForms, setTermForm } from "../lib/term-forms.server";
import { LinkFormsModal } from "../components/TermFormStatus";
import { listSelectableForms } from "~/projects/lib/form-slots";

export const meta: Route.MetaFunction = () => [
  { title: "Notes · DALI OS" },
];

type FilterOption = { id: string; label: string };

// The filter bar's columns. Values are the display strings each row carries
// (project name, domain label, vibe label), matched in the browser.
const FILTER_COLUMNS: FilterColumn[] = [
  { key: "project", label: "Project", icon: FolderKanban },
  { key: "domain", label: "Domain", icon: Layers },
  { key: "status", label: "Status", icon: Activity },
];

// The synthetic status value for a due week with no rating (see isUnfilled).
const UNFILLED_LABEL = "Not filled in";

type LoaderData = {
  filters: {
    // Free-text people search, matched against the mentor and the mentee of
    // every row. Seeded from the URL; typing filters in the browser.
    query: string;
    termId: string;
  };
  // Seed for the filter bar, mapped from the legacy ?projectId / ?domainId /
  // ?status deep-link params (the Members profile and saved filter sets still
  // send them). An unknown id is ignored so a stale link just shows everyone.
  initialFilters: ColumnFilter[];
  options: {
    domains: FilterOption[];
    terms: FilterOption[];
  };
  grid: MentorGridResult;
  // Mentors with at least one unfilled note in the current term/project/domain
  // scope (ignoring the status + text-search view lenses, to match what the
  // nudge action re-derives server-side). Feeds the bulk-nudge recipient
  // preview and the per-mentor nudge buttons.
  nudgeRecipients: { id: string; name: string; count: number }[];
  // Core only: each domain's week 5 forms for the selected term, and the forms
  // that can be linked. Mentees' answers may be about their mentor.
  termForms: TermForms | null;
  formOptions: { id: string; name: string }[];
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
  if (await isNonMember(auth, request)) return redirect("/portal");
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
    termId: termParam !== null ? termParam : defaultTerm?.id ?? "",
  };
  const projectParam = pickFilter(url.searchParams.get("projectId"));
  const domainParam = pickFilter(url.searchParams.get("domainId"));
  const statusParam = pickFilter(url.searchParams.get("status"));

  // Every lab mentor sees all pairs/notes lab-wide (Core included); the scope
  // helpers only narrow a caller who isn't a mentor at all.
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
    domains: domainsWithPairs.map((d) => ({
      id: d.id,
      label: `${d.displayName} (${d.code})`,
    })),
    // Mentorship keeps its own single-term grid + "Any term" escape hatch (the
    // grid's week axis needs exactly one term), so it isn't the shared
    // TermFilter — but it labels the current term the same way for consistency.
    terms: terms.map((t) => ({
      id: t.id,
      label: t.id === current?.id ? `${t.code} (current)` : t.code,
    })),
  };

  const linkedProject = projectsWithPairs.find((p) => p.id === projectParam);
  const linkedDomain = options.domains.find((d) => d.id === domainParam);
  const statusLabel =
    statusParam === "unfilled"
      ? UNFILLED_LABEL
      : VIBES.includes(statusParam as Vibe)
        ? VIBE_META[statusParam as Vibe].label
        : null;
  const initialFilters: ColumnFilter[] = [
    ...(linkedProject ? [{ columnKey: "project", values: [linkedProject.name] }] : []),
    ...(linkedDomain ? [{ columnKey: "domain", values: [linkedDomain.label] }] : []),
    ...(statusLabel ? [{ columnKey: "status", values: [statusLabel] }] : []),
  ];

  // The grid is a mentor → mentees → weeks matrix, scoped to one term. Without
  // a selected term there's no week axis, so we render an empty-state prompt.
  // Project/domain/status narrowing happens in the browser (the filter bar),
  // so the grid loads the viewer's full term scope.
  const grid: LoaderData["grid"] = selectedTerm
    ? await buildGrid({
        term: selectedTerm,
        viewerId: auth.user.sub,
        pairScope,
        noteScope,
      })
    : { weeks: [], currentWeek: null, mentors: [], termSelected: false };

  // Who's behind on notes, computed over the full term scope (before the
  // filter-bar/search view lenses) so it matches what the nudge action
  // re-derives server-side.
  const nudgeRecipients = grid.mentors
    .map((m) => ({
      id: m.mentor.id,
      name: `${m.mentor.firstName} ${m.mentor.lastName}`.trim(),
      count: m.rows.reduce(
        (acc, r) => acc + r.cells.filter(isUnfilled).length,
        0,
      ),
    }))
    .filter((r) => r.count > 0);

  const me = await prisma.user.findUnique({
    where: { id: auth.user.sub },
    select: { firstName: true, lastName: true },
  });

  const viewerIsCore = await isCore(auth.user.sub);
  const people = grid.mentors.flatMap((m) => [m.mentor.id, ...m.rows.map((r) => r.menteeId)]);
  const [termForms, formOptions] = viewerIsCore
    ? await Promise.all([
        selectedTerm ? loadTermForms(selectedTerm, [...new Set(people)]) : {},
        listSelectableForms(),
      ])
    : [null, []];

  const data: LoaderData = {
    filters,
    initialFilters,
    options,
    grid,
    nudgeRecipients,
    termForms,
    formOptions: formOptions.map((f) => ({ id: f.id, name: f.name })),
    isCore: viewerIsCore,
    viewerId: auth.user.sub,
    collabToken: await getCollabToken(request),
    userName: [me?.firstName, me?.lastName].filter(Boolean).join(" ") || "Core",
  };
  return data;
}

export async function action({ request }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  if (!(await isCore(auth.user.sub))) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  const form = await request.formData();
  const termId = form.get("termId");
  const domainId = form.get("domainId");
  const role = form.get("role");
  const formId = form.get("formId");
  if (
    form.get("intent") !== "link-form" ||
    typeof termId !== "string" ||
    !termId ||
    typeof domainId !== "string" ||
    !domainId ||
    !isTermFormRole(role) ||
    typeof formId !== "string"
  ) {
    return Response.json({ error: "Bad request" }, { status: 400 });
  }
  await setTermForm(termId, domainId, role, formId || null);
  return { ok: true };
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
  const { pageTitle } = useOsChrome();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [nudgeOpen, setNudgeOpen] = useState(false);
  const [nudgingId, setNudgingId] = useState<string | null>(null);
  const [query, setQuery] = useState(data.filters.query);
  const [linkFormsOpen, setLinkFormsOpen] = useState(false);
  const restored = useRef(false);
  const toast = useToast();

  const canNudge = data.isCore;
  const unfilledById = useMemo(
    () => new Map(data.nudgeRecipients.map((r) => [r.id, r.count])),
    [data.nudgeRecipients],
  );

  // `q` only enters the URL on a deep link, so re-syncing on its value can't
  // fight the keystrokes it isn't recording.
  useEffect(() => setQuery(data.filters.query), [data.filters.query]);

  const columnFilters = useColumnFilters(FILTER_COLUMNS, data.initialFilters);

  // What the filter bar matches per row, keyed by the row's grid key: the
  // project name, the domain label (as the pickers once showed it), and every
  // vibe recorded for the pair plus "Not filled in" when a due week lacks one.
  const domainLabelById = useMemo(
    () => new Map(data.options.domains.map((d) => [d.id, d.label])),
    [data.options.domains],
  );
  const cellsByRowKey = useMemo(() => {
    const map = new Map<string, FilterCells>();
    for (const m of data.grid.mentors) {
      for (const r of m.rows) {
        map.set(r.key, {
          project: r.projectName,
          domain: domainLabelById.get(r.domainId) ?? r.domainCode,
          status: [
            ...new Set(
              r.cells.flatMap((c) => (c.vibe ? [VIBE_META[c.vibe].label] : [])),
            ),
            ...(r.cells.some(isUnfilled) ? [UNFILLED_LABEL] : []),
          ],
        });
      }
    }
    return map;
  }, [data.grid.mentors, domainLabelById]);
  const allRows = useMemo(
    () => [...cellsByRowKey.values()].map((cells) => ({ cells })),
    [cellsByRowKey],
  );

  const groups = useMemo(() => {
    const searched = searchGrid(data.grid.mentors, query);
    if (columnFilters.active.length === 0) return searched;
    return searched
      .map((m) => ({
        ...m,
        rows: m.rows.filter((r) =>
          columnFilters.predicate({ cells: cellsByRowKey.get(r.key) ?? {} }),
        ),
      }))
      .filter((m) => m.rows.length > 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.grid.mentors, query, cellsByRowKey, columnFilters.active]);
  const shownCount = groups.reduce((n, m) => n + m.rows.length, 0);

  async function nudgeMentor(mentorId: string) {
    setNudgingId(mentorId);
    try {
      const res = await fetch("/api/mentorship/nudge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          termId: data.filters.termId,
          projectId: "",
          domainId: "",
          mentorId,
        }),
      });
      if (!res.ok) throw new Error(`nudge failed: ${res.status}`);
      const d = (await res.json()) as {
        messaged: string[];
        skippedNoSlack: string[];
        sentInEnv: boolean;
      };
      if (!d.sentInEnv) {
        toast("Slack DMs are prod-only — nothing was sent in this environment.", {
          variant: "info",
        });
      } else if (d.skippedNoSlack.length) {
        toast.error(`${d.skippedNoSlack[0]} has no linked Slack account.`);
      } else {
        toast.success(`Reminder sent to ${d.messaged[0] ?? "mentor"}.`);
      }
    } catch {
      toast.error("Couldn't send the reminder. Try again.");
    } finally {
      setNudgingId(null);
    }
  }

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
      <header className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className={pageTitle}>Mentorship notes</h1>
        <div className="flex items-center gap-2 ml-auto">
          {data.termForms && (
            <Tooltip content={data.filters.termId ? null : "Pick a term first."}>
              <span>
                <button
                  type="button"
                  onClick={() => setLinkFormsOpen(true)}
                  disabled={!data.filters.termId}
                  className="os-edit-btn disabled:opacity-50"
                >
                  <Link2 className="w-4 h-4 text-os-grey" aria-hidden />
                  Link forms
                </button>
              </span>
            </Tooltip>
          )}
          {canNudge && (
            <button
              type="button"
              onClick={() => setNudgeOpen(true)}
              className="os-edit-btn"
            >
              <Send className={cn("w-4 h-4", "text-os-grey")} aria-hidden />
              Message unfilled
            </button>
          )}
          {data.isCore && (
            <button
              type="button"
              onClick={() => setTemplatesOpen(true)}
              className="os-edit-btn"
            >
              <LayoutTemplate
                className={cn("w-4 h-4", "text-os-grey")}
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
            buttonClassName={cn(filterPillClass(), "sm:w-40")}
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

      {canNudge && (
        <NudgeModal
          open={nudgeOpen}
          onClose={() => setNudgeOpen(false)}
          termId={data.filters.termId}
          projectId=""
          domainId=""
          recipients={data.nudgeRecipients.map((r) => ({
            name: r.name,
            count: r.count,
          }))}
        />
      )}

      <div className="flex items-center gap-3 flex-wrap">
        <SearchInput
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search mentors and mentees…"
          aria-label="Search mentors and mentees"
          containerClassName="flex-1 min-w-[200px] max-w-[420px]"
        />
        <div className="min-w-[220px] flex-1">
          <ColumnFilters
            columns={FILTER_COLUMNS}
            rows={allRows}
            filters={columnFilters.filters}
            onChange={columnFilters.setFilters}
            shownCount={shownCount}
            noun={["pair", "pairs"]}
          />
        </div>
      </div>

      {linkFormsOpen && data.termForms && data.filters.termId && (
        <LinkFormsModal
          open
          onClose={() => setLinkFormsOpen(false)}
          termId={data.filters.termId}
          domains={data.options.domains}
          initialDomainId=""
          termForms={data.termForms}
          forms={data.formOptions}
        />
      )}

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
            termForms={data.termForms ?? undefined}
            nudge={
              canNudge
                ? {
                    count: unfilledById.get(group.mentor.id) ?? 0,
                    busy: nudgingId === group.mentor.id,
                    onNudge: () => nudgeMentor(group.mentor.id),
                  }
                : undefined
            }
          />
        ))
      )}
    </main>
  );
}

