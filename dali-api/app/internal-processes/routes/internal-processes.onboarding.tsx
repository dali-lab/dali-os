import { redirect, useFetcher, useLoaderData, useNavigate, useSearchParams } from "react-router";
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
    return { cycles, selectedCycleId: null, domains: [], selectedDomain: null, rows: [] };
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
                  figmaInvitedAt: true,
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
  const allRows = [];
  for (const d of decisions) {
    const u = d.domainApplication.application.user;
    const dom = d.domainApplication.domain;
    // Skip people who've already finished onboarding (e.g. a Fellowship-cycle
    // member re-accepted into a new domain). They keep their existing
    // onboardedAt/daliEmail/slackUserId, so there's nothing to track here — they'd
    // just be all-green clutter on a board meant for in-flight onboarding.
    if (u.daliMember?.onboardedAt != null) continue;
    // Stable key for dedupe + the domain filter dropdown (code, falling back to
    // name); displayName is for display only and can change.
    const domainKey = dom.code ?? dom.name;
    const key = `${u.id}:${domainKey}`;
    if (seen.has(key)) continue;
    seen.add(key);
    allRows.push({
      userId: u.id,
      name: [u.firstName, u.lastName].filter(Boolean).join(" ") || u.daliEmail || u.id,
      domainKey,
      role: dom.displayName ?? dom.name,
      daliEmail: u.daliEmail,
      emailCreated: !!u.daliEmail,
      inSlack: !!u.slackUserId,
      figmaInvited: u.figmaInvitedAt != null,
      profileSubmitted: u.daliMember?.onboardedAt != null,
    });
  }

  // Domain options for the filter = distinct domains present among the cycle's
  // accepted rows, sorted by label. Derived from the data so the dropdown only
  // ever offers domains that actually have accepted members.
  const domains = Array.from(
    new Map(allRows.map((r) => [r.domainKey, r.role])).entries(),
  )
    .map(([key, label]) => ({ key, label }))
    .sort((a, b) => a.label.localeCompare(b.label));

  // Selected domain: ?domain= when it matches one of this cycle's domains, else
  // "all". Reset implicitly when switching cycles to a domain that isn't present.
  const requestedDomain = url.searchParams.get("domain");
  const selectedDomain =
    requestedDomain && domains.some((d) => d.key === requestedDomain)
      ? requestedDomain
      : null;

  const rows = selectedDomain
    ? allRows.filter((r) => r.domainKey === selectedDomain)
    : allRows;

  return { cycles, selectedCycleId, domains, selectedDomain, rows };
}

// Toggle a member's manual "invited to Figma" state from the onboarding board.
// Core-only, mirroring the loader's access tier. Sets figmaInvitedAt to now when
// checking, or null when unchecking.
export async function action({ request }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await isCore(auth.user.sub))) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const form = await request.formData();
  if (form.get("intent") !== "toggleFigma") {
    return Response.json({ error: "Unknown intent" }, { status: 400 });
  }
  const userId = String(form.get("userId") ?? "");
  const invited = form.get("invited") === "true";
  if (!userId) return Response.json({ error: "Missing userId" }, { status: 400 });

  await prisma.user.update({
    where: { id: userId },
    data: { figmaInvitedAt: invited ? new Date() : null },
  });
  return Response.json({ ok: true, figmaInvited: invited });
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

// Admin checkbox for the manual "invited to Figma" step. Submits to this route's
// action via a fetcher; optimistic so it flips immediately. stopPropagation
// keeps the click from triggering the row's navigate-to-profile.
function FigmaCheckbox({ userId, invited }: { userId: string; invited: boolean }) {
  const fetcher = useFetcher<{ figmaInvited?: boolean }>();
  // Optimistic: while submitting, reflect the value we just sent.
  const pending = fetcher.formData?.get("invited");
  const checked = pending != null ? pending === "true" : invited;

  return (
    <label
      className="inline-flex cursor-pointer items-center gap-2 text-xs text-muted-foreground"
      onClick={(e) => e.stopPropagation()}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={fetcher.state !== "idle"}
        onChange={() =>
          fetcher.submit(
            { intent: "toggleFigma", userId, invited: String(!checked) },
            { method: "post" },
          )
        }
        className="h-4 w-4 rounded border-border accent-green-600"
      />
      {checked ? "Invited" : "Not invited"}
    </label>
  );
}

export default function InternalProcessesOnboarding() {
  const { cycles, selectedCycleId, domains, selectedDomain, rows } = useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  function setParam(key: string, value: string | null) {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    setSearchParams(next, { replace: true });
  }

  return (
    <div className="px-6 md:px-10 py-8">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="font-heading text-2xl font-bold text-dark-blue">Onboarding</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Accepted applicants and their onboarding progress.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {domains.length > 0 && (
            <select
              value={selectedDomain ?? ""}
              onChange={(e) => setParam("domain", e.target.value || null)}
              className="rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium text-dark-blue"
            >
              <option value="">All domains</option>
              {domains.map((d) => (
                <option key={d.key} value={d.key}>
                  {d.label}
                </option>
              ))}
            </select>
          )}
          {cycles.length > 0 && (
            <select
              value={selectedCycleId ?? ""}
              onChange={(e) => setParam("cycle", e.target.value)}
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
      </div>

      {!selectedCycleId ? (
        <div className="rounded-2xl border border-border bg-card py-16 text-center">
          <p className="text-muted-foreground">No application cycles yet.</p>
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card py-16 text-center">
          <p className="text-muted-foreground">
            {selectedDomain
              ? "No accepted applicants in this domain for the selected cycle."
              : "No accepted applicants in this cycle yet."}
          </p>
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
                <th className="px-5 py-3 font-heading font-semibold text-dark-blue">Figma</th>
                <th className="px-5 py-3 font-heading font-semibold text-dark-blue">Profile form</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((r) => (
                <tr
                  key={`${r.userId}-${r.role}`}
                  onClick={() => navigate(`/members/${r.userId}`)}
                  className="cursor-pointer hover:bg-muted/30"
                >
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
                    <FigmaCheckbox userId={r.userId} invited={r.figmaInvited} />
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
