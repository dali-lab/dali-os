import { useMemo, useState } from "react";
import { redirect, useLoaderData } from "react-router";
import type { Route } from "./+types/projects.intent-to-work";
import { requireAuth } from "~/lib/auth";
import { canManageStaffing, currentTerm } from "~/lib/roles";
import { prisma } from "~/lib/db";
import { ensureStaffingCycle } from "../lib/staffing-cycle";
import { SubmissionFilters } from "../components/SubmissionFilters";

export const meta: Route.MetaFunction = () => [
  { title: "Intent to Work · DALI OS" },
];

// Read-only database of received Intent-to-Work submissions for the current
// cycle. Staffing leads only — members submit via the Intent to Work form
// (POST /api/projects/intent-to-work).
export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");
  if (auth.user.type === "applicant") return redirect("/portal");
  if (!(await canManageStaffing(auth.user.sub))) return redirect("/");

  const term = await currentTerm();
  if (!term) return { gate: "no-cycle" as const };
  const cycle = await ensureStaffingCycle(term.id, term.code);

  const terms = await prisma.term.findMany({
    where: { sortKey: { gte: term.sortKey } },
    orderBy: { sortKey: "asc" },
    take: 4,
    select: { id: true, code: true },
  });

  // The mirrored IntentToWork rows are the source of truth for the board;
  // the table reads them directly so it stays correct regardless of which
  // form version a member answered.
  const rows = await prisma.intentToWork.findMany({
    where: { staffingCycleId: cycle.id },
    select: {
      userId: true,
      termId: true,
      status: true,
      updatedAt: true,
      user: { select: { firstName: true, lastName: true, daliEmail: true } },
    },
  });

  // IntentToWork rows carry no domain; a member's domain(s) come from their
  // DomainEligibility. Fetch eligibilities for the submitting members so the
  // table can be filtered by domain.
  const userIds = [...new Set(rows.map((r) => r.userId))];
  const eligibilities = await prisma.domainEligibility.findMany({
    where: { userId: { in: userIds } },
    select: {
      userId: true,
      domain: { select: { id: true, displayName: true } },
    },
  });
  const domainsByUser = new Map<string, { id: string; name: string }[]>();
  for (const e of eligibilities) {
    const list = domainsByUser.get(e.userId) ?? [];
    list.push({ id: e.domain.id, name: e.domain.displayName });
    domainsByUser.set(e.userId, list);
  }

  const byUser = new Map<
    string,
    {
      userId: string;
      name: string;
      email: string | null;
      domains: { id: string; name: string }[];
      statuses: Record<string, string>;
      updatedAt: string;
    }
  >();
  for (const r of rows) {
    const existing = byUser.get(r.userId);
    const updatedAt = r.updatedAt.toISOString();
    if (!existing) {
      byUser.set(r.userId, {
        userId: r.userId,
        name: `${r.user.firstName} ${r.user.lastName}`,
        email: r.user.daliEmail,
        domains: domainsByUser.get(r.userId) ?? [],
        statuses: { [r.termId]: r.status },
        updatedAt,
      });
    } else {
      existing.statuses[r.termId] = r.status;
      if (updatedAt > existing.updatedAt) existing.updatedAt = updatedAt;
    }
  }

  const submissions = [...byUser.values()].sort((a, b) =>
    a.name.localeCompare(b.name),
  );

  // Distinct domains across all submitting members, for the filter dropdown.
  const domainFilter = [
    ...new Map(
      submissions.flatMap((s) => s.domains).map((d) => [d.id, d]),
    ).values(),
  ].sort((a, b) => a.name.localeCompare(b.name));

  return {
    gate: "ok" as const,
    cycle: { name: cycle.name },
    terms,
    submissions,
    domainFilter,
  };
}

const STATUS_PILL: Record<string, string> = {
  Returning: "bg-emerald-500/15 text-emerald-600",
  Off: "bg-muted text-foreground",
  Leave: "bg-amber-500/15 text-amber-600",
  Graduating: "bg-sky-500/15 text-sky-600",
  Unsure: "bg-muted text-muted-foreground",
};

export default function IntentToWorkDatabase() {
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
  data: Extract<
    Awaited<ReturnType<typeof loader>>,
    { gate: "ok" }
  >;
}) {
  const [query, setQuery] = useState("");
  const [domainId, setDomainId] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return data.submissions.filter((s) => {
      if (q && !`${s.name} ${s.email ?? ""}`.toLowerCase().includes(q)) {
        return false;
      }
      if (domainId && !s.domains.some((d) => d.id === domainId)) {
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
            No intent submissions yet.
          </div>
        ) : filtered.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">
            No members match the current filters.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[640px]">
              <thead className="bg-muted/30 text-muted-foreground text-xs uppercase tracking-wide">
                <tr>
                  <th className="text-left font-medium px-4 py-2">Member</th>
                  {data.terms.map((t) => (
                    <th
                      key={t.id}
                      className="text-left font-medium px-4 py-2"
                    >
                      {t.code}
                    </th>
                  ))}
                  <th className="text-left font-medium px-4 py-2">Updated</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((s) => (
                  <tr
                    key={s.userId}
                    className="border-t border-border hover:bg-muted/20"
                  >
                    <td className="px-4 py-2">
                      <div className="text-foreground">{s.name}</div>
                      {s.email && (
                        <div className="text-xs text-muted-foreground">
                          {s.email}
                        </div>
                      )}
                    </td>
                    {data.terms.map((t) => {
                      const st = s.statuses[t.id];
                      return (
                        <td key={t.id} className="px-4 py-2">
                          {st ? (
                            <span
                              className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded ${
                                STATUS_PILL[st] ?? "bg-muted text-foreground"
                              }`}
                            >
                              {st}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                      );
                    })}
                    <td className="px-4 py-2 text-muted-foreground">
                      {new Date(s.updatedAt).toLocaleDateString()}
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

function Header({ cycleName }: { cycleName?: string }) {
  return (
    <header>
      <h1 className="font-heading text-2xl font-bold text-foreground">
        Intent to Work
      </h1>
      <p className="text-sm text-muted-foreground mt-1">
        Received intent submissions{cycleName ? ` for ${cycleName}` : ""}.
      </p>
    </header>
  );
}
