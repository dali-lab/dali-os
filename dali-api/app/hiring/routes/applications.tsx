import { useMemo, useState } from "react";
import { redirect, useLoaderData, useNavigate, useSearchParams } from "react-router";
import { Search } from "lucide-react";
import type { Route } from "./+types/applications";
import { requireAuth } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { getUserRoles } from "~/lib/roles";
import { prisma } from "~/lib/db";
import { hiringPills } from "~/hiring/components/hiringPills";
import { AreaPillNav } from "~/components/AreaPillNav";

export const handle = { areaPills: true };

export const meta: Route.MetaFunction = () => [
  { title: "Applications · Hiring · DALI OS" },
];

// Database view of every application submission for a cycle. One row per
// (applicant, domain) — i.e. per DomainApplication. Access:
//   • Core/Admin (isCore): every domain in every cycle.
//   • Reviewers: only the domains they're a CycleReviewer for, and only the
//     cycles they're assigned on.
// Read-only — rows link to the read-only detail page.
export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  if (auth.user.type === "applicant") return redirect("/portal");

  const { isCore, isAdmin, isDomainLead, isInterviewer } = await getUserRoles(auth.user.sub);

  // Reviewer assignments across all cycles — used both to decide which cycles
  // a reviewer can see and to scope domains within the selected cycle.
  const reviewerRows = await prisma.cycleReviewer.findMany({
    where: { userId: auth.user.sub },
    select: { applicationCycleId: true, domainId: true },
  });

  // Hard gate: a user with no hiring role at all (not Core/Admin/DomainLead and
  // a reviewer/interviewer on no cycle) has no business here — send them home
  // rather than showing the "you aren't a reviewer" empty state. (The sidebar
  // already hides Hiring for them; this stops direct navigation too.)
  if (!isCore && !isAdmin && !isDomainLead && reviewerRows.length === 0) {
    const interviewer = await prisma.cycleInterviewer.findFirst({
      where: { userId: auth.user.sub },
      select: { id: true },
    });
    if (!interviewer) return redirect("/");
  }

  // Cycle dropdown: Core sees every cycle; a reviewer sees only the cycles
  // they're assigned on.
  const reviewerCycleIds = new Set(reviewerRows.map((r) => r.applicationCycleId));
  const cyclesRaw = await prisma.applicationCycle.findMany({
    where: isCore ? {} : { id: { in: [...reviewerCycleIds] } },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      createdAt: true,
      // Status is event-sourced; newest update wins, default Draft.
      statusUpdates: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { newStatus: true },
      },
    },
  });
  const cycles = cyclesRaw.map((c) => ({
    id: c.id,
    name: c.name,
    createdAt: c.createdAt,
    currentStatus: c.statusUpdates[0]?.newStatus ?? "Draft",
  }));

  // Neither a Core member with no cycles nor a reviewer with no assignments
  // has anything to show.
  const pillRoles = { isCore, isDomainLead, isAdmin, isInterviewer };

  if (cycles.length === 0) {
    return {
      gate: "empty" as const,
      isCore,
      pillRoles,
    };
  }

  // Selected cycle: ?cycle= if valid, else most recent.
  const url = new URL(request.url);
  const requested = url.searchParams.get("cycle");
  const selected =
    (requested && cycles.find((c) => c.id === requested)) || cycles[0];

  // Domains visible to this user for the selected cycle. Core: all of the
  // cycle's hiring domains. Reviewer: only their assigned domains for THIS
  // cycle.
  const cycleDomainRows = await prisma.domainApplicationCycle.findMany({
    where: { applicationCycleId: selected.id },
    select: { domainId: true },
  });
  const allCycleDomainIds = cycleDomainRows.map((d) => d.domainId);
  const reviewerDomainIdsThisCycle = reviewerRows
    .filter((r) => r.applicationCycleId === selected.id)
    .map((r) => r.domainId);
  const visibleDomainIds = isCore
    ? allCycleDomainIds
    : reviewerDomainIdsThisCycle;

  // Domain filter options — the domains this user can see for the selected
  // cycle, with display names. Drives the (client-side) domain dropdown,
  // shown whenever there's more than one domain to choose between.
  const domainOptions = visibleDomainIds.length
    ? (
        await prisma.domain.findMany({
          where: { id: { in: visibleDomainIds } },
          orderBy: { displayName: "asc" },
          select: { id: true, displayName: true },
        })
      ).map((d) => ({ id: d.id, name: d.displayName }))
    : [];

  // DomainApplications for the selected cycle, scoped to visible domains.
  // Standard cycles link Domain via challengeVersion; InternToFull links
  // Domain directly — match whichever path is set (mirrors reviewer route).
  const domainApps = visibleDomainIds.length
    ? await prisma.domainApplication.findMany({
        where: {
          application: { applicationCycleId: selected.id },
          selected: true,
          OR: [
            { challengeVersion: { domainId: { in: visibleDomainIds } } },
            { domainId: { in: visibleDomainIds } },
          ],
        },
        select: {
          id: true,
          domainId: true,
          domain: { select: { displayName: true } },
          challengeVersion: {
            select: { domain: { select: { displayName: true } } },
          },
          application: {
            select: {
              user: {
                select: { firstName: true, lastName: true, daliEmail: true, dartmouthEmail: true },
              },
              // Status is event-sourced via ApplicationStatusUpdate; the
              // newest row is the current status. We also grab the most
              // recent "Submitted" event's timestamp for the Submitted column.
              statusUpdates: {
                orderBy: { createdAt: "desc" },
                select: { newStatus: true, createdAt: true },
              },
            },
          },
          _count: { select: { reviews: true } },
        },
      })
    : [];

  const rows = domainApps
    .map((da) => {
      const u = da.application.user;
      const updates = da.application.statusUpdates;
      const status = updates[0]?.newStatus ?? "Draft";
      const submittedAt =
        updates.find((s) => s.newStatus === "Submitted")?.createdAt ?? null;
      return {
        id: da.id,
        name: `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() || "—",
        email: u.daliEmail ?? u.dartmouthEmail ?? null,
        domainId: da.domainId,
        domain:
          da.domain?.displayName ??
          da.challengeVersion?.domain?.displayName ??
          "—",
        status: status as string,
        submittedAt: submittedAt ? submittedAt.toISOString() : null,
        reviewCount: da._count.reviews,
      };
    })
    .sort(
      (a, b) =>
        a.name.localeCompare(b.name) || a.domain.localeCompare(b.domain),
    );

  return {
    gate: "ok" as const,
    isCore,
    pillRoles,
    cycles: cycles.map((c) => ({
      id: c.id,
      name: c.name,
      status: c.currentStatus as string,
    })),
    selectedCycleId: selected.id,
    selectedCycleName: selected.name,
    domainOptions,
    rows,
  };
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

const STATUS_TONE: Record<string, string> = {
  Submitted: "bg-green-50 text-green-700 border border-green-100",
  Draft: "bg-muted text-muted-foreground",
  Withdrawn: "bg-red-50 text-red-700 border border-red-100",
};

export default function ApplicationsDatabase() {
  const data = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  // Client-side filters. "" = all. Reset when the cycle changes (different
  // cycle = different domain set) by keying off the selected cycle below.
  const [domainId, setDomainId] = useState("");
  const [status, setStatus] = useState("");
  const [query, setQuery] = useState("");

  const rows = data.gate === "ok" ? data.rows : [];
  const filteredRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (domainId && r.domainId !== domainId) return false;
      if (status && r.status !== status) return false;
      if (q && !`${r.name} ${r.email ?? ""}`.toLowerCase().includes(q))
        return false;
      return true;
    });
  }, [rows, domainId, status, query]);

  const areaPills = (
    <AreaPillNav items={hiringPills({ ...data.pillRoles, active: "applications" })} />
  );

  if (data.gate === "empty") {
    return (
      <div className="flex flex-col gap-4">
        {areaPills}
        <Header />
        <p className="text-sm text-muted-foreground">
          {data.isCore
            ? "No application cycles exist yet."
            : "You aren't assigned as a reviewer on any cycle yet."}
        </p>
      </div>
    );
  }

  // Only worth showing the domain filter when there's more than one domain
  // to choose between (Core/Admin, or a reviewer covering multiple domains).
  const showDomainFilter = data.domainOptions.length > 1;

  return (
    <div className="flex flex-col gap-4">
      {areaPills}
      <Header />

      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
        <label
          htmlFor="cycle-select"
          className="text-sm font-medium text-muted-foreground"
        >
          Cycle
        </label>
        <select
          id="cycle-select"
          value={data.selectedCycleId}
          onChange={(e) => {
            setDomainId("");
            setStatus("");
            setQuery("");
            const next = new URLSearchParams(searchParams);
            next.set("cycle", e.target.value);
            setSearchParams(next);
          }}
          className="px-3 py-1.5 text-sm border border-border rounded-md bg-background text-foreground sm:w-72"
        >
          {data.cycles.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} · {c.status}
            </option>
          ))}
        </select>
        {showDomainFilter && (
          <select
            aria-label="Filter by domain"
            value={domainId}
            onChange={(e) => setDomainId(e.target.value)}
            className="px-3 py-1.5 text-sm border border-border rounded-md bg-background text-foreground sm:w-48"
          >
            <option value="">All domains</option>
            {data.domainOptions.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        )}
        <select
          aria-label="Filter by status"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="px-3 py-1.5 text-sm border border-border rounded-md bg-background text-foreground sm:w-40"
        >
          <option value="">All statuses</option>
          {Object.keys(STATUS_TONE).map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <div className="relative w-full sm:ml-auto sm:w-64 min-w-[12rem]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/70 pointer-events-none" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name or email"
            aria-label="Search applicants by name or email"
            className="w-full pl-8 pr-3 py-1.5 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
          />
        </div>
      </div>

      <div className="bg-card border border-border rounded-lg overflow-hidden">
        {filteredRows.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">
            {rows.length === 0 ? (
              <>
                No submissions for {data.selectedCycleName}
                {data.isCore ? "" : " in your domains"}.
              </>
            ) : (
              "No applicants match the current filters."
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[640px]">
              <thead className="bg-muted/30 text-muted-foreground text-xs uppercase tracking-wide">
                <tr>
                  <th className="text-left font-medium px-4 py-2">
                    Applicant ({filteredRows.length}
                    {filteredRows.length === data.rows.length
                      ? ""
                      : ` of ${data.rows.length}`}
                    )
                  </th>
                  <th className="text-left font-medium px-4 py-2">Domain</th>
                  <th className="text-left font-medium px-4 py-2">Status</th>
                  <th className="text-left font-medium px-4 py-2">Submitted</th>
                  <th className="text-left font-medium px-4 py-2">Reviews</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((r) => (
                  <tr
                    key={r.id}
                    onClick={() => navigate(`/hiring/applications/${r.id}`)}
                    className="border-t border-border hover:bg-muted/20 cursor-pointer"
                  >
                    <td className="px-4 py-2 text-foreground">{r.name}</td>
                    <td className="px-4 py-2 text-foreground">{r.domain}</td>
                    <td className="px-4 py-2">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                          STATUS_TONE[r.status] ?? "bg-muted text-muted-foreground"
                        }`}
                      >
                        {r.status}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">
                      {r.submittedAt ? formatDate(r.submittedAt) : "—"}
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">
                      {r.reviewCount}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function Header() {
  return (
    <header>
      <h1 className="font-heading text-2xl font-bold text-foreground">
        Applications
      </h1>
      <p className="text-sm text-muted-foreground mt-1">
        Every submission for a cycle. Pick a cycle to view its applicants.
      </p>
    </header>
  );
}
