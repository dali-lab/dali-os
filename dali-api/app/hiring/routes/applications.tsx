import { useMemo, useState } from "react";
import { redirect, useLoaderData, useNavigate, useSearchParams } from "react-router";
import { Search, Inbox, ChevronRight } from "lucide-react";
import type { Route } from "./+types/applications";
import { requireAuth } from "~/lib/auth";
import { getUserRoles } from "~/lib/roles";
import { prisma } from "~/lib/db";
import { hiringPills } from "~/hiring/components/hiringPills";
import { AreaPillNav } from "~/components/AreaPillNav";
import { PageHeader } from "~/hiring/components/PageHeader";
import { EmptyState } from "~/hiring/components/EmptyState";
import { CycleStatusPill, Pill } from "~/hiring/components/Pill";

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
  if (!auth.ok) return redirect("/login");
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

// Application submission status tones. Composed through the shared `Pill`
// helper so these read the same shape as every other hiring status chip.
const STATUS_TONE: Record<string, string> = {
  Submitted: "bg-green-100 text-green-700",
  Draft: "bg-muted text-foreground/80",
  Withdrawn: "bg-red-100 text-red-700",
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
      <div className="flex flex-col gap-5">
        {areaPills}
        <Header />
        <EmptyState
          icon={Inbox}
          title={data.isCore ? "No cycles yet" : "No cycles assigned to you"}
          description={
            data.isCore
              ? "Applications appear here once a cycle is created and applicants start submitting."
              : "You aren't a reviewer on any cycle yet. Once you're assigned, its applicants show up here."
          }
          action={data.isCore ? { label: "Set up a cycle", to: "/hiring/lead" } : undefined}
        />
      </div>
    );
  }

  // Only worth showing the domain filter when there's more than one domain
  // to choose between (Core/Admin, or a reviewer covering multiple domains).
  const showDomainFilter = data.domainOptions.length > 1;

  const selectedCycle = data.cycles.find((c) => c.id === data.selectedCycleId);
  const isFiltered = domainId !== "" || status !== "" || query.trim() !== "";

  return (
    <div className="flex flex-col gap-5">
      {areaPills}
      <Header
        chip={selectedCycle ? <CycleStatusPill status={selectedCycle.status} /> : undefined}
      />

      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <label htmlFor="cycle-select" className="sr-only">
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
          className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30 sm:w-72"
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
            className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30 sm:w-48"
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
          className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30 sm:w-40"
        >
          <option value="">All statuses</option>
          {Object.keys(STATUS_TONE).map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <div className="relative w-full min-w-[12rem] sm:ml-auto sm:w-64">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/70" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name or email"
            aria-label="Search applicants by name or email"
            className="w-full rounded-md border border-border bg-background py-2 pl-8 pr-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
          />
        </div>
      </div>

      {filteredRows.length === 0 ? (
        <EmptyState
          icon={rows.length === 0 ? Inbox : Search}
          title={
            rows.length === 0 ? "No submissions yet" : "No matching applicants"
          }
          description={
            rows.length === 0
              ? `Nothing has been submitted for ${data.selectedCycleName}${
                  data.isCore ? "" : " in your domains"
                } yet.`
              : "No applicants match the current filters. Try clearing your search or status filter."
          }
        />
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="border-b border-border bg-muted/40 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th scope="col" className="px-4 py-3 text-left">
                    Applicant
                    <span className="ml-1.5 font-normal normal-case text-muted-foreground/70">
                      {filteredRows.length}
                      {isFiltered ? ` of ${data.rows.length}` : ""}
                    </span>
                  </th>
                  <th scope="col" className="px-4 py-3 text-left">Domain</th>
                  <th scope="col" className="px-4 py-3 text-left">Status</th>
                  <th scope="col" className="px-4 py-3 text-left">Submitted</th>
                  <th scope="col" className="px-4 py-3 text-left">Reviews</th>
                  <th scope="col" className="w-10 px-4 py-3">
                    <span className="sr-only">Open</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((r) => (
                  <tr
                    key={r.id}
                    onClick={() => navigate(`/hiring/applications/${r.id}`)}
                    className="group cursor-pointer border-t border-border transition-colors hover:bg-muted/40"
                  >
                    <td className="px-4 py-3 font-medium text-foreground">
                      {r.name}
                      {r.email && (
                        <span className="ml-2 hidden font-normal text-muted-foreground sm:inline">
                          {r.email}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-foreground">{r.domain}</td>
                    <td className="px-4 py-3">
                      <Pill color={STATUS_TONE[r.status]}>{r.status}</Pill>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {r.submittedAt ? formatDate(r.submittedAt) : "—"}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {r.reviewCount}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <ChevronRight
                        className="ml-auto h-4 w-4 text-muted-foreground/40 transition-colors group-hover:text-accent-coral"
                        aria-hidden
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function Header({ chip }: { chip?: React.ReactNode }) {
  return (
    <PageHeader
      title="Applications"
      subtitle="Every submission for a cycle. Pick a cycle to browse its applicants."
      chip={chip}
    />
  );
}
