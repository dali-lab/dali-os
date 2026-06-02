import { redirect, useLoaderData, useSearchParams } from "react-router";
import type { Route } from "./+types/internal-processes.onboarding";
import { requireAuth } from "~/lib/auth";
import { isCore } from "~/lib/roles";
import { prisma } from "~/lib/db";

export const meta: Route.MetaFunction = () => [
  { title: "Onboarding · DALI OS" },
];

// Core-only: this surfaces accepted-applicant PII (DALI emails) and per-member
// provisioning state, the same sensitivity tier as the hiring lead dashboard.
export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");
  if (!(await isCore(auth.user.sub))) return redirect("/");

  // Cycle dropdown options — newest first, like the lead dashboard.
  const cycles = await prisma.applicationCycle.findMany({
    select: { id: true, name: true, cycleType: true },
    orderBy: { createdAt: "desc" },
  });

  // Selected cycle: ?cycle= when valid, else the newest cycle.
  const url = new URL(request.url);
  const requested = url.searchParams.get("cycle");
  const selectedCycleId =
    (requested && cycles.some((c) => c.id === requested) ? requested : null) ??
    cycles[0]?.id ??
    null;

  if (!selectedCycleId) {
    return { cycles, selectedCycleId: null, rows: [] };
  }

  // Accepted applicants for the cycle = released "Accepted" decisions. One row
  // per accepted DomainApplication (a person accepted into two domains shows
  // twice, each with its own role). Status fields are read LIVE off the user /
  // member row so they reflect reality even after manual fixes or re-provisioning.
  const decisions = await prisma.decision.findMany({
    where: {
      stage: "Released",
      type: "Accepted",
      domainApplication: {
        application: { applicationCycleId: selectedCycleId },
      },
    },
    select: {
      id: true,
      createdAt: true,
      domainApplication: {
        select: {
          domain: { select: { displayName: true, name: true, code: true } },
          application: {
            select: {
              user: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  daliEmail: true,
                  slackUserId: true,
                  daliMember: { select: { onboardedAt: true } },
                },
              },
            },
          },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  // A person can hold multiple accepted decisions for the same domain over a
  // cycle's lifetime (re-release); collapse to the latest per (user, domain).
  const seen = new Set<string>();
  const rows = [];
  for (const d of decisions) {
    const u = d.domainApplication.application.user;
    const dom = d.domainApplication.domain;
    const key = `${u.id}:${dom.code ?? dom.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      userId: u.id,
      name: [u.firstName, u.lastName].filter(Boolean).join(" ") || u.daliEmail || u.id,
      role: dom.displayName ?? dom.name,
      daliEmail: u.daliEmail,
      emailCreated: !!u.daliEmail,
      inSlack: !!u.slackUserId,
      profileSubmitted: u.daliMember?.onboardedAt != null,
    });
  }

  return { cycles, selectedCycleId, rows };
}

function StatusPill({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${
        ok ? "bg-green-100 text-green-700" : "bg-muted text-muted-foreground"
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${ok ? "bg-green-500" : "bg-muted-foreground/40"}`} />
      {label}
    </span>
  );
}

export default function InternalProcessesOnboarding() {
  const { cycles, selectedCycleId, rows } = useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();

  return (
    <div className="px-6 md:px-10 py-8">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="font-heading text-2xl font-bold text-dark-blue">Onboarding</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Accepted applicants and their onboarding progress.
          </p>
        </div>
        {cycles.length > 0 && (
          <select
            value={selectedCycleId ?? ""}
            onChange={(e) => {
              const next = new URLSearchParams(searchParams);
              next.set("cycle", e.target.value);
              setSearchParams(next, { replace: true });
            }}
            className="rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium text-dark-blue"
          >
            {cycles.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {!selectedCycleId ? (
        <div className="rounded-2xl border border-border bg-card py-16 text-center">
          <p className="text-muted-foreground">No application cycles yet.</p>
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card py-16 text-center">
          <p className="text-muted-foreground">No accepted applicants in this cycle yet.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border">
          <table className="w-full text-sm">
            <thead className="bg-brand-tint text-left">
              <tr>
                <th className="px-5 py-3 font-heading font-semibold text-dark-blue">Member</th>
                <th className="px-5 py-3 font-heading font-semibold text-dark-blue">Role</th>
                <th className="px-5 py-3 font-heading font-semibold text-dark-blue">DALI email</th>
                <th className="px-5 py-3 font-heading font-semibold text-dark-blue">Slack</th>
                <th className="px-5 py-3 font-heading font-semibold text-dark-blue">Profile form</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((r) => (
                <tr key={`${r.userId}-${r.role}`} className="hover:bg-muted/30">
                  <td className="px-5 py-3 font-medium text-dark-blue">{r.name}</td>
                  <td className="px-5 py-3 text-muted-foreground">{r.role}</td>
                  <td className="px-5 py-3">
                    {r.emailCreated ? (
                      <span className="font-mono text-xs text-dark-blue">{r.daliEmail}</span>
                    ) : (
                      <StatusPill ok={false} label="Not created" />
                    )}
                  </td>
                  <td className="px-5 py-3">
                    <StatusPill ok={r.inSlack} label={r.inSlack ? "Joined" : "Not joined"} />
                  </td>
                  <td className="px-5 py-3">
                    <StatusPill ok={r.profileSubmitted} label={r.profileSubmitted ? "Submitted" : "Pending"} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
