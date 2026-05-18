import { useMemo, useState } from "react";
import { redirect, useLoaderData } from "react-router";
import type { Route } from "./+types/projects.project-bids";
import { requireAuth } from "~/lib/auth";
import { canManageStaffing, currentTerm } from "~/lib/roles";
import { prisma } from "~/lib/db";
import { ensureStaffingCycle } from "../lib/staffing-cycle";
import { SubmissionFilters } from "../components/SubmissionFilters";

export const meta: Route.MetaFunction = () => [
  { title: "Project Bids · DALI OS" },
];

// Read-only database of received Project Bid submissions for the current
// cycle. Staffing leads only — members rank projects at
// /forms/project-bids/submit.
export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");
  if (auth.user.type === "applicant") return redirect("/portal");
  if (!(await canManageStaffing(auth.user.sub))) return redirect("/");

  const term = await currentTerm();
  if (!term) return { gate: "no-cycle" as const };
  const cycle = await ensureStaffingCycle(term.id, term.code);

  // StaffingPreference rows are the source of truth for the staffing board;
  // the table reads them directly so it stays correct regardless of which
  // form version a member answered.
  const rows = await prisma.staffingPreference.findMany({
    where: { staffingCycleId: cycle.id },
    orderBy: [{ userId: "asc" }, { preferenceRank: "asc" }],
    select: {
      userId: true,
      projectId: true,
      domainId: true,
      preferenceRank: true,
      level: true,
      notes: true,
      user: { select: { firstName: true, lastName: true, daliEmail: true } },
    },
  });

  // StaffingPreference stores projectId/domainId as bare strings (no
  // relations), so resolve display names in one batched lookup each.
  const projectIds = [...new Set(rows.map((r) => r.projectId))];
  const domainIds = [...new Set(rows.map((r) => r.domainId))];
  const [projects, domains] = await Promise.all([
    prisma.project.findMany({
      where: { id: { in: projectIds } },
      select: { id: true, name: true },
    }),
    prisma.domain.findMany({
      where: { id: { in: domainIds } },
      select: { id: true, displayName: true },
    }),
  ]);
  const projectName = new Map(projects.map((p) => [p.id, p.name]));
  const domainName = new Map(domains.map((d) => [d.id, d.displayName]));

  const byUser = new Map<
    string,
    {
      userId: string;
      name: string;
      email: string | null;
      bids: {
        rank: number;
        project: string;
        domainId: string;
        domain: string;
        level: string;
        notes: string | null;
      }[];
    }
  >();
  for (const r of rows) {
    const existing = byUser.get(r.userId);
    const bid = {
      rank: r.preferenceRank,
      project: projectName.get(r.projectId) ?? "(unknown project)",
      domainId: r.domainId,
      domain: domainName.get(r.domainId) ?? "(unknown domain)",
      level: r.level as string,
      notes: r.notes,
    };
    if (!existing) {
      byUser.set(r.userId, {
        userId: r.userId,
        name: `${r.user.firstName} ${r.user.lastName}`,
        email: r.user.daliEmail,
        bids: [bid],
      });
    } else {
      existing.bids.push(bid);
    }
  }

  const submissions = [...byUser.values()].sort((a, b) =>
    a.name.localeCompare(b.name),
  );

  // Distinct domains across all bids, for the filter dropdown.
  const domainFilter = [...domainName.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    gate: "ok" as const,
    cycle: { name: cycle.name },
    submissions,
    domainFilter,
  };
}

export default function ProjectBidsDatabase() {
  const data = useLoaderData<typeof loader>();

  if (data.gate === "no-cycle") {
    return (
      <div className="flex flex-col gap-4">
        <Header />
        <p className="text-sm text-muted-foreground">
          No active staffing term right now.
        </p>
      </div>
    );
  }

  return <Loaded data={data} />;
}

function Loaded({
  data,
}: {
  data: Extract<Awaited<ReturnType<typeof loader>>, { gate: "ok" }>;
}) {
  const [query, setQuery] = useState("");
  const [domainId, setDomainId] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return data.submissions.filter((s) => {
      if (q && !`${s.name} ${s.email ?? ""}`.toLowerCase().includes(q)) {
        return false;
      }
      if (domainId && !s.bids.some((b) => b.domainId === domainId)) {
        return false;
      }
      return true;
    });
  }, [data.submissions, query, domainId]);

  return (
    <div className="flex flex-col gap-4">
      <Header cycleName={data.cycle.name} />

      <SubmissionFilters
        query={query}
        onQueryChange={setQuery}
        domainId={domainId}
        onDomainChange={setDomainId}
        domains={data.domainFilter}
      />

      <div className="bg-card border border-border rounded-lg">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h2 className="text-sm font-medium text-foreground">Submissions</h2>
          <span className="text-xs text-muted-foreground">
            {filtered.length}
            {filtered.length === data.submissions.length
              ? ""
              : ` of ${data.submissions.length}`}{" "}
            member
            {data.submissions.length === 1 ? "" : "s"}
          </span>
        </div>
        {data.submissions.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">
            No bid submissions yet.
          </div>
        ) : filtered.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">
            No members match the current filters.
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {filtered.map((s) => (
              <li key={s.userId} className="px-4 py-3">
                <div className="mb-2">
                  <div className="text-sm text-foreground">{s.name}</div>
                  {s.email && (
                    <div className="text-xs text-muted-foreground">
                      {s.email}
                    </div>
                  )}
                </div>
                <ol className="flex flex-wrap gap-x-4 gap-y-1.5">
                  {s.bids.map((b) => (
                    <li
                      key={b.rank}
                      className="flex items-start gap-2 text-sm"
                    >
                      <span className="shrink-0 w-5 h-5 rounded-full bg-accent-coral text-white text-xs font-semibold flex items-center justify-center">
                        {b.rank}
                      </span>
                      <div className="min-w-0">
                        <div className="text-foreground">
                          {b.project}
                          <span className="text-muted-foreground">
                            {" "}
                            · {b.domain} · {b.level}
                          </span>
                        </div>
                        {b.notes && (
                          <div className="text-xs text-muted-foreground mt-0.5">
                            {b.notes}
                          </div>
                        )}
                      </div>
                    </li>
                  ))}
                </ol>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Header({ cycleName }: { cycleName?: string }) {
  return (
    <header>
      <h1 className="font-heading text-2xl font-bold text-foreground">
        Project Bids
      </h1>
      <p className="text-sm text-muted-foreground mt-1">
        Received bid submissions{cycleName ? ` for ${cycleName}` : ""}.
        Members submit at <code>/forms/project-bids/submit</code>.
      </p>
    </header>
  );
}
