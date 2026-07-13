import { useMemo, useState } from "react";
import {
  Form,
  Link,
  redirect,
  useActionData,
  useLoaderData,
  useNavigate,
} from "react-router";
import type { DragEndEvent } from "@dnd-kit/core";
import { KanbanBoard, type KanbanColumn } from "~/components/board/KanbanBoard";
import type { Route } from "./+types/partners.applications";
import { requireAuth } from "~/lib/auth";
import { requestOpenTabIfEmbedded } from "~/components/workspace-link";
import { prisma } from "~/lib/db";
import { canViewStaffing, isCore } from "~/lib/roles";
import { resolvePhotoUrl } from "~/lib/photo";
import {
  PARTNER_APPLICATION_STATUSES as STATUSES,
  PARTNER_APPLICATION_STATUS_LABELS as STATUS_LABEL,
  PARTNER_APPLICATION_STATUS_PILL,
  PROJECTING_STATUSES,
  type PartnerApplicationStatus as Status,
} from "../lib/partner-application";
import { useChartColors } from "~/hiring/components/analytics/useChartColors";
import {
  clearApplicationFormBinding,
  getApplicationFormBinding,
  pitchExcerpt,
  setApplicationFormBinding,
} from "../lib/application-form.server";
import type { Question } from "~/types";
import { listSelectableForms } from "~/projects/lib/form-slots";
import { AreaPillNav } from "~/components/AreaPillNav";

export const meta: Route.MetaFunction = () => [
  { title: "Partner Applications · DALI OS" },
];


type DomainScopeOut = {
  domainId: string;
  domainName: string;
  expectedMembers: number;
};

type ApplicationRow = {
  id: string;
  title: string;
  status: Status;
  partnerName: string;
  partnerLogoUrl: string | null;
  // The partner's pitch prose: first textarea answer from their form
  // submission, falling back to the (Core-written) internal summary.
  excerpt: string | null;
  targetTerms: { code: string; sortKey: number }[];
  domains: DomainScopeOut[];
  totalExpectedMembers: number;
};

// One (term, domain) cell of the required-headcount series, summed from
// ProjectRoleRequest.slots across all non-archived projects.
type RequiredCell = {
  termCode: string;
  termSortKey: number;
  domainId: string;
  domainName: string;
  slots: number;
};

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");
  if (auth.user.type === "applicant") return redirect("/portal");
  if (!(await canViewStaffing(auth.user.sub))) return redirect("/");

  const [applications, partnerOrgs, canEdit, roleRequests] =
    await Promise.all([
    prisma.partnerApplication.findMany({
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      select: {
        id: true,
        title: true,
        summary: true,
        status: true,
        partnerOrg: { select: { name: true, logoUrl: true } },
        formSubmission: {
          select: {
            answers: true,
            formVersion: { select: { questions: true } },
          },
        },
        targetTerms: {
          orderBy: { term: { sortKey: "asc" } },
          select: { term: { select: { code: true, sortKey: true } } },
        },
        domains: {
          select: {
            domainId: true,
            expectedMembers: true,
            domain: { select: { displayName: true } },
          },
        },
      },
    }),
    prisma.partnerOrg.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    isCore(auth.user.sub),
    // Required headcount = the slots staffing must fill, per term/domain.
    // Archived projects no longer need staffing, so exclude them.
    prisma.projectRoleRequest.findMany({
      where: { project: { status: { not: "Archived" } } },
      select: {
        slots: true,
        term: { select: { code: true, sortKey: true } },
        domain: { select: { id: true, displayName: true } },
      },
    }),
  ]);

  const rows: ApplicationRow[] = await Promise.all(applications.map(async (a) => {
    const domains = a.domains.map((d) => ({
      domainId: d.domainId,
      domainName: d.domain.displayName,
      expectedMembers: d.expectedMembers,
    }));
    const answerExcerpt = a.formSubmission
      ? pitchExcerpt(
          (a.formSubmission.formVersion.questions as unknown as Question[]) ?? [],
          (a.formSubmission.answers as Record<string, unknown>) ?? {},
        )
      : null;
    return {
      id: a.id,
      title: a.title,
      status: a.status,
      partnerName: a.partnerOrg.name,
      excerpt: answerExcerpt ?? a.summary,
      // Uploaded logos are stored as S3 keys; presign for display.
      partnerLogoUrl: await resolvePhotoUrl(a.partnerOrg.logoUrl),
      targetTerms: a.targetTerms.map((t) => ({
        code: t.term.code,
        sortKey: t.term.sortKey,
      })),
      domains,
      totalExpectedMembers: domains.reduce((s, d) => s + d.expectedMembers, 0),
    };
  }));

  // Collapse role requests to one cell per (term, domain), summing slots
  // across projects and across P1/P2/P3 levels.
  const requiredMap = new Map<string, RequiredCell>();
  for (const rr of roleRequests) {
    const key = `${rr.term.code}::${rr.domain.id}`;
    const cell = requiredMap.get(key);
    if (cell) {
      cell.slots += rr.slots;
    } else {
      requiredMap.set(key, {
        termCode: rr.term.code,
        termSortKey: rr.term.sortKey,
        domainId: rr.domain.id,
        domainName: rr.domain.displayName,
        slots: rr.slots,
      });
    }
  }
  const requiredCells = [...requiredMap.values()];

  // Which generic Form partners answer on /partner/apply, plus the pickable
  // forms — Core-only config, so skip both queries for everyone else.
  const [formBinding, selectableForms] = canEdit
    ? await Promise.all([getApplicationFormBinding(), listSelectableForms()])
    : [null, []];

  return { rows, partnerOrgs, canEdit, requiredCells, formBinding, selectableForms };
}

export async function action({ request }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");
  if (auth.user.type === "applicant") return redirect("/portal");
  if (!(await isCore(auth.user.sub))) {
    return { error: "You don't have permission to create applications." };
  }

  const form = await request.formData();
  const intent = (form.get("intent") as string | null) ?? "create";

  if (intent === "bind-form") {
    const formId = (form.get("formId") as string | null) ?? "";
    if (!formId) return { error: "Choose a form to bind." };
    const result = await setApplicationFormBinding(formId, auth.user.sub);
    return result.ok ? { ok: true } : { error: result.error };
  }
  if (intent === "clear-form") {
    await clearApplicationFormBinding();
    return { ok: true };
  }

  const title = (form.get("title") as string | null)?.trim() ?? "";
  const partnerOrgId = (form.get("partnerOrgId") as string | null) ?? "";

  if (!title) return { error: "A title is required." };
  if (!partnerOrgId) return { error: "Select a partner." };

  const partner = await prisma.partnerOrg.findUnique({
    where: { id: partnerOrgId },
    select: { id: true },
  });
  if (!partner) return { error: "That partner no longer exists." };

  const created = await prisma.partnerApplication.create({
    data: { title, partnerOrgId },
    select: { id: true },
  });
  return redirect(`/partners/applications/${created.id}`);
}

export default function PartnersApplications() {
  const { rows, partnerOrgs, canEdit, requiredCells, formBinding, selectableForms } =
    useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<Status | "all">("all");
  const [domainFilter, setDomainFilter] = useState<string>("all");
  const [view, setView] = useState<"list" | "board">("list");
  const [creating, setCreating] = useState(false);
  // Board drag applies a status change here and persists it via the API.
  // Held at this level (not inside the board) so the projection chart and the
  // list both reflect a pending move without a full loader refetch — the
  // chart's other input (required slots) can't change from a status flip.
  const [pendingStatus, setPendingStatus] = useState<Record<string, Status>>(
    {},
  );

  const effectiveRows = useMemo(
    () =>
      rows.map((r) =>
        pendingStatus[r.id] ? { ...r, status: pendingStatus[r.id] } : r,
      ),
    [rows, pendingStatus],
  );

  const domainOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of rows) {
      for (const d of r.domains) if (!seen.has(d.domainId)) seen.set(d.domainId, d.domainName);
    }
    return [...seen.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [rows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return effectiveRows.filter((r) => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (domainFilter !== "all" && !r.domains.some((d) => d.domainId === domainFilter))
        return false;
      if (!q) return true;
      if (r.title.toLowerCase().includes(q)) return true;
      if (r.partnerName.toLowerCase().includes(q)) return true;
      return r.domains.some((d) => d.domainName.toLowerCase().includes(q));
    });
  }, [effectiveRows, query, statusFilter, domainFilter]);

  return (
    <div className="flex flex-col gap-4">
      <AreaPillNav
        items={[
          { label: "Hub", to: "/partners" },
          { label: "Applications", to: "/partners/applications", active: true },
        ]}
      />
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="font-heading text-2xl font-bold text-foreground">
            Partner Applications
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Inbound partner pitches, their expected scope per domain, and where
            they sit in review.
          </p>
        </div>
        {canEdit && !creating && (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="px-3 py-1.5 text-sm font-medium rounded-md bg-accent-coral text-white hover:bg-accent-coral/90 transition-colors"
          >
            + New application
          </button>
        )}
      </header>

      {actionData?.error && (
        <div className="bg-destructive/10 border border-destructive/30 text-destructive text-sm rounded-md px-3 py-2">
          {actionData.error}
        </div>
      )}

      {creating && canEdit && (
        <Form
          method="post"
          onSubmit={() => setCreating(false)}
          className="bg-card border border-border rounded-lg p-4 flex flex-col gap-3"
        >
          <h2 className="text-sm font-semibold text-foreground">
            New partner application
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-muted-foreground">Title</span>
              <input
                name="title"
                autoFocus
                required
                placeholder="What is the partner pitching?"
                className="px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-muted-foreground">Partner</span>
              <select
                name="partnerOrgId"
                required
                defaultValue=""
                className="px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
              >
                <option value="" disabled>
                  Select a partner…
                </option>
                {partnerOrgs.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setCreating(false)}
              className="px-3 py-1.5 text-xs font-medium rounded-md border border-border hover:bg-muted transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-3 py-1.5 text-xs font-medium rounded-md bg-accent-coral text-white hover:bg-accent-coral/90 transition-colors"
            >
              Create
            </button>
          </div>
        </Form>
      )}

      {canEdit && (
        <section className="bg-card border border-border rounded-lg p-4 flex flex-col gap-2">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h2 className="text-sm font-semibold text-foreground">
                Application form
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Extra questions partners answer when pitching a project.
                {formBinding && (
                  <>
                    {" "}
                    <Link
                      to={`/forms/edit/${formBinding.formId}`}
                      className="underline hover:text-foreground"
                    >
                      Edit “{formBinding.formName}” in Forms
                    </Link>
                  </>
                )}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Form method="post" className="flex items-center gap-2">
                <input type="hidden" name="intent" value="bind-form" />
                <select
                  name="formId"
                  defaultValue={formBinding?.formId ?? ""}
                  className="px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
                >
                  <option value="" disabled>
                    Choose a form…
                  </option>
                  {selectableForms.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                      {f.published ? "" : " (unpublished)"}
                    </option>
                  ))}
                </select>
                <button
                  type="submit"
                  className="px-3 py-1.5 text-xs font-medium rounded-md border border-border hover:bg-muted transition-colors"
                >
                  {formBinding ? "Change" : "Bind"}
                </button>
              </Form>
              {formBinding && (
                <Form method="post">
                  <input type="hidden" name="intent" value="clear-form" />
                  <button
                    type="submit"
                    className="px-3 py-1.5 text-xs font-medium rounded-md border border-border text-muted-foreground hover:text-destructive hover:border-destructive/40 transition-colors"
                  >
                    Remove
                  </button>
                </Form>
              )}
            </div>
          </div>
          {formBinding && (!formBinding.published || !formBinding.hasVersion) && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2 py-1.5">
              {formBinding.hasVersion
                ? "This form isn't published yet"
                : "This form has no saved version yet"}
              {" "}— partners currently see only the built-in pitch fields.
            </p>
          )}
        </section>
      )}

      <TermProjection rows={effectiveRows} requiredCells={requiredCells} />

      <div className="flex items-center gap-3 flex-wrap">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by title, partner, or domain"
          className="flex-1 min-w-[200px] max-w-sm px-3 py-2 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
        />
        {view === "list" && (
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as Status | "all")}
            aria-label="Filter by status"
            className="px-2 py-2 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
          >
            <option value="all">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        )}
        <select
          value={domainFilter}
          onChange={(e) => setDomainFilter(e.target.value)}
          aria-label="Filter by domain"
          className="px-2 py-2 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
        >
          <option value="all">All domains</option>
          {domainOptions.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
        <div className="flex rounded-md border border-border overflow-hidden">
          {(["list", "board"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => {
                setView(v);
                // The board shows every status as a column; a lingering
                // status filter would silently hide columns.
                if (v === "board") setStatusFilter("all");
              }}
              aria-pressed={view === v}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                view === v
                  ? "bg-accent-coral text-white"
                  : "bg-background text-muted-foreground hover:bg-muted"
              }`}
            >
              {v === "list" ? "List" : "Board"}
            </button>
          ))}
        </div>
      </div>

      {view === "list" ? (
        <div className="bg-card border border-border rounded-lg">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <h2 className="text-sm font-medium text-foreground">Applications</h2>
            <span className="text-xs text-muted-foreground">
              {filtered.length}{" "}
              {filtered.length === 1 ? "application" : "applications"}
              {filtered.length !== rows.length ? ` of ${rows.length}` : ""}
            </span>
          </div>

          {filtered.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              {rows.length === 0
                ? "No partner applications yet."
                : "No applications match these filters."}
            </div>
          ) : (
            <ApplicationsTable rows={filtered} />
          )}
        </div>
      ) : (
        <ApplicationsBoard
          rows={filtered}
          canEdit={canEdit}
          onMove={(id, toStatus) =>
            setPendingStatus((m) => ({ ...m, [id]: toStatus }))
          }
          onRevert={(id) =>
            setPendingStatus((m) => {
              const { [id]: _drop, ...rest } = m;
              return rest;
            })
          }
        />
      )}
    </div>
  );
}

type Series = { perDomain: Map<string, number>; total: number };

function emptySeries(): Series {
  return { perDomain: new Map(), total: 0 };
}
function addTo(s: Series, domainId: string, n: number) {
  if (n === 0) return;
  s.perDomain.set(domainId, (s.perDomain.get(domainId) ?? 0) + n);
  s.total += n;
}

// Per-term projection of *expected* lab members (from under-review +
// accepted partner applications, by target term) against *required* members
// (from project role-request slots, by term). The domain filter narrows the
// per-term bars to a single domain's numbers.
function TermProjection({
  rows,
  requiredCells,
}: {
  rows: ApplicationRow[];
  requiredCells: RequiredCell[];
}) {
  const chart = useChartColors();
  const [domainFocus, setDomainFocus] = useState<string>("all");

  // Domain catalog = union of domains seen in either series, name-sorted so
  // color assignment is stable across renders and reloads.
  const domains = useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of rows) {
      if (!PROJECTING_STATUSES.includes(r.status)) continue;
      for (const d of r.domains) {
        if (!seen.has(d.domainId)) seen.set(d.domainId, d.domainName);
      }
    }
    for (const c of requiredCells) {
      if (!seen.has(c.domainId)) seen.set(c.domainId, c.domainName);
    }
    return [...seen.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [rows, requiredCells]);

  const palette = useMemo(
    () => [
      chart.teal,
      chart.coral,
      chart.green,
      chart.pink,
      chart.yellow,
      chart.coralLight,
    ],
    [chart],
  );
  const colorOf = (domainId: string) => {
    const i = domains.findIndex((d) => d.id === domainId);
    return i < 0 ? chart.muted : palette[i % palette.length];
  };

  const inFocus = (domainId: string) =>
    domainFocus === "all" || domainId === domainFocus;

  // One group per term, oldest → newest, each holding the expected and
  // required Series for that term. A term appears if either series touches it.
  const byTerm = useMemo(() => {
    const map = new Map<
      string,
      { code: string; sortKey: number; expected: Series; required: Series }
    >();
    const ensure = (code: string, sortKey: number) => {
      let g = map.get(code);
      if (!g) {
        g = { code, sortKey, expected: emptySeries(), required: emptySeries() };
        map.set(code, g);
      }
      return g;
    };
    for (const r of rows) {
      if (!PROJECTING_STATUSES.includes(r.status)) continue;
      // An application's expected headcount counts toward every term it
      // targets — a 3-term engagement needs that team in all 3 terms.
      for (const t of r.targetTerms) {
        const g = ensure(t.code, t.sortKey);
        for (const d of r.domains) {
          if (inFocus(d.domainId))
            addTo(g.expected, d.domainId, d.expectedMembers);
        }
      }
    }
    for (const c of requiredCells) {
      const g = ensure(c.termCode, c.termSortKey);
      if (inFocus(c.domainId)) addTo(g.required, c.domainId, c.slots);
    }
    return [...map.values()].sort((a, b) => a.sortKey - b.sortKey);
  }, [rows, requiredCells, domainFocus]);

  const hasData = byTerm.some(
    (t) => t.expected.total > 0 || t.required.total > 0,
  );

  return (
    <section className="bg-card border border-border rounded-lg p-4">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
        <h2 className="text-sm font-semibold text-foreground">
          Expected vs required lab members
        </h2>
        <select
          value={domainFocus}
          onChange={(e) => setDomainFocus(e.target.value)}
          aria-label="Focus on a domain"
          className="text-xs px-2 py-1 border border-border rounded-md bg-background text-muted-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
        >
          <option value="all">All domains</option>
          {domains.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </div>
      {!hasData ? (
        <p className="text-sm text-muted-foreground italic">
          No projection yet — add expected headcount to applications under
          review/accepted, or role requests to projects.
        </p>
      ) : (
        <TermBars byTerm={byTerm} domains={domains} colorOf={colorOf} />
      )}

      {hasData && (
        <div className="flex flex-col gap-2 mt-4">
          {/* Solid bar = Expected, washed-out bar = Required. */}
          <div className="flex flex-wrap gap-x-4 gap-y-1.5">
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="w-3 h-3 rounded-sm bg-foreground/70" />
              Expected
            </span>
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="w-3 h-3 rounded-sm bg-foreground/70 opacity-[0.55]" />
              Required
            </span>
          </div>
          {domainFocus === "all" && (
            <div className="flex flex-wrap gap-x-4 gap-y-1.5">
              {domains.map((d) => (
                <span
                  key={d.id}
                  className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"
                >
                  <span
                    className="w-3 h-3 rounded-sm"
                    style={{ backgroundColor: colorOf(d.id) }}
                  />
                  {d.name}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

// A single stacked bar: domain segments sized within `barTotal`, drawn to a
// pixel height relative to `chartMax`. `dim` washes out the Required bar so
// it reads as the target line rather than competing with Expected.
function StackedBar({
  series,
  domains,
  colorOf,
  chartMax,
  dim,
}: {
  series: Series;
  domains: { id: string; name: string }[];
  colorOf: (domainId: string) => string;
  chartMax: number;
  dim?: boolean;
}) {
  return (
    <div
      className="w-9 flex flex-col-reverse overflow-hidden"
      style={{
        height: `${series.total === 0 ? 2 : Math.max(8, (series.total / chartMax) * 120)}px`,
        opacity: dim ? 0.55 : 1,
      }}
    >
      {domains.map((d) => {
        const n = series.perDomain.get(d.id) ?? 0;
        if (n === 0) return null;
        return (
          <div
            key={d.id}
            style={{
              height: `${(n / series.total) * 100}%`,
              backgroundColor: colorOf(d.id),
            }}
            title={`${d.name}: ${n}`}
          />
        );
      })}
    </div>
  );
}

function TermBars({
  byTerm,
  domains,
  colorOf,
}: {
  byTerm: {
    code: string;
    expected: Series;
    required: Series;
  }[];
  domains: { id: string; name: string }[];
  colorOf: (domainId: string) => string;
}) {
  const max = Math.max(
    ...byTerm.flatMap((t) => [t.expected.total, t.required.total]),
    1,
  );
  return (
    <div className="flex items-end gap-6 pt-2 overflow-x-auto">
      {byTerm.map((t) => (
        <div key={t.code} className="flex flex-col items-center gap-2">
          <div className="flex items-end gap-1.5">
            <LabeledBar
              label="Exp"
              series={t.expected}
              domains={domains}
              colorOf={colorOf}
              chartMax={max}
            />
            <LabeledBar
              label="Req"
              series={t.required}
              domains={domains}
              colorOf={colorOf}
              chartMax={max}
              dim
            />
          </div>
          <span className="text-xs text-foreground">{t.code}</span>
        </div>
      ))}
    </div>
  );
}

// A count above one StackedBar, with an Exp/Req tag beneath so each bar is
// self-labeled (the user can't tell expected from required otherwise). `dim`
// (the Required bar) mutes the count to match the bar's washed-out fill.
function LabeledBar({
  label,
  series,
  domains,
  colorOf,
  chartMax,
  dim,
}: {
  label: string;
  series: Series;
  domains: { id: string; name: string }[];
  colorOf: (domainId: string) => string;
  chartMax: number;
  dim?: boolean;
}) {
  return (
    <div className="flex flex-col items-center gap-1">
      <span
        className={`text-xs font-medium ${dim ? "text-muted-foreground" : "text-foreground"}`}
      >
        {series.total}
      </span>
      <StackedBar
        series={series}
        domains={domains}
        colorOf={colorOf}
        chartMax={chartMax}
        dim={dim}
      />
      <span className="text-[10px] text-muted-foreground">{label}</span>
    </div>
  );
}

function StatusPill({ status }: { status: Status }) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded ${PARTNER_APPLICATION_STATUS_PILL[status]}`}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

function ApplicationsTable({ rows }: { rows: ApplicationRow[] }) {
  const navigate = useNavigate();
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm min-w-[760px]">
        <thead className="bg-muted/30 text-muted-foreground text-xs uppercase tracking-wide">
          <tr>
            <th className="text-left font-medium px-4 py-2">Title</th>
            <th className="text-left font-medium px-4 py-2">Partner</th>
            <th className="text-left font-medium px-4 py-2">Status</th>
            <th className="text-left font-medium px-4 py-2">Target term</th>
            <th className="text-left font-medium px-4 py-2">Domains</th>
            <th className="text-right font-medium px-4 py-2">Expected</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((a) => (
            <tr
              key={a.id}
              onClick={() => {
                const url = `/partners/applications/${a.id}`;
                if (!requestOpenTabIfEmbedded(url, a.title)) navigate(url);
              }}
              className="border-t border-border hover:bg-muted/20 cursor-pointer"
            >
              <td className="px-4 py-2">
                <span className="text-foreground block">{a.title}</span>
                {a.excerpt && (
                  <span className="text-xs text-muted-foreground block truncate max-w-md">
                    {a.excerpt}
                  </span>
                )}
              </td>
              <td className="px-4 py-2 text-muted-foreground">{a.partnerName}</td>
              <td className="px-4 py-2">
                <StatusPill status={a.status} />
              </td>
              <td className="px-4 py-2 text-muted-foreground">
                {a.targetTerms.length > 0
                  ? a.targetTerms.map((t) => t.code).join(", ")
                  : "—"}
              </td>
              <td className="px-4 py-2 text-muted-foreground">
                {a.domains.length > 0
                  ? a.domains.map((d) => d.domainName).join(", ")
                  : "—"}
              </td>
              <td className="px-4 py-2 text-right text-foreground tabular-nums">
                {a.totalExpectedMembers || "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// `rows` already reflects pending moves (the parent merges the optimistic
// status so the projection chart stays in sync), so a drop just calls onMove
// then POSTs, and onRevert on failure — no loader refetch. The optimistic state
// lives in the parent, so the board uses only the POST/rollback half of the
// shared flow rather than `useOptimisticBoardMove`'s local state.
function ApplicationsBoard({
  rows,
  canEdit,
  onMove,
  onRevert,
}: {
  rows: ApplicationRow[];
  canEdit: boolean;
  onMove: (id: string, toStatus: Status) => void;
  onRevert: (id: string) => void;
}) {
  const [error, setError] = useState<string | null>(null);

  const byStatus = useMemo(() => {
    const map: Record<Status, ApplicationRow[]> = {
      Submitted: [],
      UnderReview: [],
      OnHold: [],
      Accepted: [],
      Rejected: [],
    };
    for (const a of rows) map[a.status].push(a);
    return map;
  }, [rows]);

  function handleDragEnd(event: DragEndEvent) {
    if (!canEdit) return;
    const overId = event.over?.id;
    if (!overId || typeof overId !== "string") return;
    const data = event.active.data.current as
      | { applicationId?: string; fromStatus?: Status }
      | undefined;
    const id = data?.applicationId;
    const fromStatus = data?.fromStatus;
    if (!id || !fromStatus) return;
    const toStatus = overId as Status;
    if (toStatus === fromStatus) return;

    onMove(id, toStatus);
    setError(null);

    void (async () => {
      try {
        const res = await fetch(`/api/partner-applications/${id}/status`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: toStatus }),
        });
        if (!res.ok) {
          const b = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(b.error ?? `Request failed: ${res.status}`);
        }
      } catch (err) {
        onRevert(id);
        setError(err instanceof Error ? err.message : "Failed to move");
      }
    })();
  }

  const columns: KanbanColumn<ApplicationRow>[] = STATUSES.map((status) => ({
    id: status,
    title: <StatusPill status={status} />,
    cards: byStatus[status],
    className: "flex-shrink-0 w-72 border rounded-lg border-border bg-card flex flex-col",
  }));

  return (
    <KanbanBoard<ApplicationRow>
      // Stable id so SSR/client agree when multiple DndContexts mount (see
      // StaffingBoard for the hydration-mismatch rationale).
      id="partner-applications-board"
      columns={columns}
      getCardId={(a) => a.id}
      getCardData={(a) => ({ applicationId: a.id, fromStatus: a.status })}
      draggable={canEdit}
      onDragEnd={handleDragEnd}
      error={error}
      renderCard={(app, { isDragging, dragHandleProps }) => (
        <ApplicationCard
          app={app}
          draggable={canEdit}
          dragHandleProps={dragHandleProps}
          isDragging={isDragging}
        />
      )}
    />
  );
}

function ApplicationCard({
  app,
  draggable,
  dragHandleProps,
  isDragging,
}: {
  app: ApplicationRow;
  draggable: boolean;
  dragHandleProps: Record<string, unknown>;
  isDragging: boolean;
}) {
  const navigate = useNavigate();

  // The whole card is the drag handle (matching the original behavior); the
  // activation-distance sensor lets a press that doesn't move land as a click.
  const dragProps = draggable ? dragHandleProps : {};

  return (
    <div
      {...dragProps}
      onClick={() => {
        const url = `/partners/applications/${app.id}`;
        if (!requestOpenTabIfEmbedded(url, app.title)) navigate(url);
      }}
      className={`border border-border rounded-md bg-background p-2.5 text-sm flex flex-col gap-2 ${
        draggable ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"
      } ${isDragging ? "opacity-60 shadow-lg" : "hover:bg-muted/20"}`}
    >
      <span className="font-semibold text-foreground">{app.title}</span>
      {app.excerpt && (
        <span className="text-xs text-muted-foreground line-clamp-2">
          {app.excerpt}
        </span>
      )}
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {app.partnerLogoUrl && (
          <img
            src={app.partnerLogoUrl}
            alt=""
            className="w-3.5 h-3.5 rounded-sm object-contain"
          />
        )}
        {app.partnerName}
      </span>
      <span className="text-xs text-muted-foreground">
        {app.targetTerms.length > 0
          ? `Target ${app.targetTerms.map((t) => t.code).join(", ")}`
          : "No target term"}
        {app.totalExpectedMembers > 0
          ? ` · ${app.totalExpectedMembers} expected`
          : ""}
      </span>
      {app.domains.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {app.domains.map((d) => (
            <span
              key={d.domainId}
              className="inline-flex items-center px-2 py-0.5 text-xs rounded bg-muted text-foreground"
            >
              {d.domainName}
              {d.expectedMembers > 0 ? ` ·${d.expectedMembers}` : ""}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
