import { useEffect, useRef, useState } from "react";
import { redirect, useLoaderData, useFetcher } from "react-router";
import type { Route } from "./+types/admin.domains";
import { adminHandle } from "~/admin/adminNav";
import { prisma } from "~/lib/db";
import { ensureDomainGroup } from "~/lib/groups";
import { requireAuth, forbidden } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { isAdmin, isCore, isAdminViaEnv, currentTerm } from "~/lib/roles";
import { LAB_MEMBER_WHERE, MEMBER_LIST_ORDER_BY } from "~/lib/prisma-shapes";
import { describeDomainUsage, DOMAIN_USAGE_COUNT_SELECT } from "./api.domains.$domainId";
import { ALLOWED_LEVELS, parseLevel, type Level } from "~/admin/lib/eligibility";
import {
  applyEligibilityWithNotify,
  removeEligibility,
} from "~/admin/lib/eligibility.server";
import { ChevronDown, Compass, Trash2, Plus, X } from "lucide-react";
import { Tooltip } from "~/components/ui/IconButton";
import {
  type DomainWithCounts,
  type Member,
  memberLabel,
  RemoveDomainLeadButton,
} from "~/admin/components/admin-shared";

export const handle = adminHandle("domains");

export const meta: Route.MetaFunction = () => [{ title: "Domains · Admin · DALI OS" }];

// Phase 2 rewrite: domain-lead assignments now key off User.id (not
// DALIMember.id) and require a termId. Lead picker lists Users with a
// DALIMember row (lab members).

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  if (!(await isCore(auth.user.sub))) return redirect("/admin/members");
  const viewerIsAdmin = await isAdmin(auth.user.sub);

  const [users, domains, term] = await Promise.all([
    prisma.user.findMany({
      where: { ...LAB_MEMBER_WHERE },
      include: {
        adminMembership: { select: { id: true, isStaff: true } },
        coreAssignments: { select: { id: true, termId: true, leadTitle: true } },
        domainLeadAssignmentsAsUser: { include: { domain: true } },
      },
      orderBy: MEMBER_LIST_ORDER_BY,
    }),
    prisma.domain.findMany({
      orderBy: { displayName: "asc" },
      include: {
        domainLeadAssignments: {
          include: {
            user: {
              select: { id: true, firstName: true, lastName: true, daliEmail: true },
            },
          },
          orderBy: [{ user: { lastName: "asc" } }, { user: { firstName: "asc" } }],
        },
        eligibilities: {
          include: {
            user: {
              select: { id: true, firstName: true, lastName: true, daliEmail: true },
            },
          },
          orderBy: [{ user: { lastName: "asc" } }, { user: { firstName: "asc" } }],
        },
        _count: { select: DOMAIN_USAGE_COUNT_SELECT },
      },
    }),
    currentTerm(),
  ]);

  const members: Member[] = users.map((u) => {
    const currentCore = term !== null
      ? u.coreAssignments.filter((a) => a.termId === term.id)
      : [];
    const isAdminUser = u.adminMembership !== null || isAdminViaEnv(u.id);
    return {
      id: u.id,
      firstName: u.firstName,
      lastName: u.lastName,
      daliEmail: u.daliEmail,
      isLabMember: true,
      isAdmin: isAdminUser,
      isStaff: u.adminMembership?.isStaff === true,
      isCore: isAdminUser || currentCore.length > 0,
      coreAssignments: currentCore.map((a) => ({ id: a.id, leadTitle: a.leadTitle })),
      domainLeadAssignments: u.domainLeadAssignmentsAsUser.map((a) => ({
        id: a.id,
        domain: { id: a.domain.id, name: a.domain.displayName },
      })),
    };
  });

  const domainsForView: DomainWithCounts[] = domains.map((d) => ({
    id: d.id,
    name: d.displayName,
    domainLeadAssignments: d.domainLeadAssignments.map((a) => ({
      id: a.id,
      user: {
        id: a.user.id,
        firstName: a.user.firstName,
        lastName: a.user.lastName,
        daliEmail: a.user.daliEmail,
      },
    })),
    eligibilities: d.eligibilities.map((e) => ({
      id: e.id,
      level: e.level as Level,
      user: {
        id: e.user.id,
        firstName: e.user.firstName,
        lastName: e.user.lastName,
        daliEmail: e.user.daliEmail,
      },
    })),
    _count: d._count,
  }));

  return { members, domains: domainsForView, viewerIsAdmin };
}

export async function action({ request }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  if (!(await isCore(auth.user.sub)))
    return forbidden(request);

  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  // Domain lifecycle (create/delete) is Admin-only — these mutations touch
  // hiring-cycle state. Lead/eligibility assignments are open to Core.
  const adminOnly = intent === "create-domain" || intent === "delete-domain";
  if (adminOnly && !(await isAdmin(auth.user.sub)))
    return forbidden(request);

  if (intent === "create-domain") {
    const name = String(formData.get("name") ?? "").trim();
    if (!name) return Response.json({ error: "Name is required" }, { status: 400 });
    // Phase 2: code + displayName required. Derive code from the name by
    // stripping non-alnum (admin can rename later). displayName mirrors
    // name on create; both editable post-create.
    const code = name.replace(/[^A-Za-z0-9]/g, "") || "Domain";
    const domain = await prisma.domain.create({
      data: { name, code, displayName: name },
    });
    await ensureDomainGroup(domain.id, domain.displayName);
    return null;
  }

  if (intent === "delete-domain") {
    const domainId = String(formData.get("domainId") ?? "");
    if (!domainId) return Response.json({ error: "domainId is required" }, { status: 400 });

    const result = await prisma.$transaction(async (tx) => {
      const domain = await tx.domain.findUnique({
        where: { id: domainId },
        include: { _count: { select: DOMAIN_USAGE_COUNT_SELECT } },
      });
      if (!domain) return { kind: "not-found" as const };
      const blocking = describeDomainUsage(domain._count);
      if (blocking.length > 0) return { kind: "in-use" as const, blocking };
      await tx.domain.delete({ where: { id: domainId } });
      return { kind: "ok" as const };
    });

    if (result.kind === "not-found") {
      return Response.json({ error: "Domain not found" }, { status: 404 });
    }
    if (result.kind === "in-use") {
      return Response.json(
        { error: `Cannot delete: domain is in use by ${result.blocking.join(", ")}.` },
        { status: 409 },
      );
    }
    return null;
  }

  if (intent === "add-domain-lead") {
    const userId = formData.get("userId") as string;
    const domainId = formData.get("domainId") as string;
    const term = await currentTerm();
    if (!term) {
      return Response.json(
        { error: "No current Term — run npm run db:seed:v0-reference" },
        { status: 500 },
      );
    }
    await prisma.domainLeadAssignment.upsert({
      where: {
        userId_domainId_termId: { userId, domainId, termId: term.id },
      },
      update: {},
      create: { userId, domainId, termId: term.id },
    });
    return null;
  }

  if (intent === "remove-domain-lead") {
    const assignmentId = formData.get("assignmentId") as string;
    await prisma.domainLeadAssignment.delete({ where: { id: assignmentId } });
    return null;
  }

  if (intent === "add-eligibility" || intent === "set-eligibility-level") {
    const userId = String(formData.get("userId") ?? "");
    const domainId = String(formData.get("domainId") ?? "");
    const level = parseLevel(formData.get("level"));
    if (!userId || !domainId || !level) {
      return Response.json({ error: "userId, domainId, and level are required" }, { status: 400 });
    }
    await applyEligibilityWithNotify({ userId, domainId, level, actorId: auth.user.sub });
    return null;
  }

  if (intent === "remove-eligibility") {
    const id = String(formData.get("eligibilityId") ?? "");
    if (!id) return Response.json({ error: "eligibilityId is required" }, { status: 400 });
    await removeEligibility({ id });
    return null;
  }

  return null;
}

function AddDomainLeadForMemberButton({ domainId, member, onAdded }: { domainId: string; member: Member; onAdded: () => void }) {
  const fetcher = useFetcher();
  return (
    <fetcher.Form method="post" onSubmit={onAdded}>
      <input type="hidden" name="intent" value="add-domain-lead" />
      <input type="hidden" name="userId" value={member.id} />
      <input type="hidden" name="domainId" value={domainId} />
      <button type="submit" className="w-full text-left px-4 py-2 text-sm text-foreground/80 hover:bg-muted/50">
        {memberLabel(member)}
      </button>
    </fetcher.Form>
  );
}

function DomainLeadsForDomain({ domain, members }: { domain: DomainWithCounts; members: Member[] }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const assignedUserIds = new Set(domain.domainLeadAssignments.map((a) => a.user.id));
  const available = members.filter((m) => !assignedUserIds.has(m.id));
  const q = search.trim().toLowerCase();
  const filtered = q
    ? available.filter((m) => memberLabel(m).toLowerCase().includes(q) || (m.daliEmail ?? "").toLowerCase().includes(q))
    : available;

  return (
    <div className="flex flex-wrap gap-1.5 items-center">
      <span className="text-xs text-muted-foreground/70 mr-1">Leads:</span>
      {domain.domainLeadAssignments.length === 0 && (
        <span className="text-xs text-muted-foreground/70 italic">none</span>
      )}
      {domain.domainLeadAssignments.map((assignment) => (
        <span
          key={assignment.id}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-800"
        >
          {memberLabel(assignment.user)}
          <RemoveDomainLeadButton assignmentId={assignment.id} />
        </span>
      ))}

      {available.length > 0 && (
        <div className="relative">
          <button
            type="button"
            onClick={() => setOpen(!open)}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-muted text-muted-foreground hover:bg-muted/70 transition-colors"
          >
            + Lead
            <ChevronDown className="w-3 h-3" />
          </button>
          {open && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => { setOpen(false); setSearch(""); }} />
              <div className="absolute left-0 z-20 mt-1 w-64 rounded-md shadow-lg bg-card ring-1 ring-black ring-opacity-5">
                <div className="p-2 border-b border-border">
                  <input
                    type="text"
                    autoFocus
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search members…"
                    className="w-full px-2 py-1 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
                  />
                </div>
                <div className="py-1 max-h-64 overflow-y-auto">
                  {filtered.length === 0 ? (
                    <div className="px-4 py-2 text-sm text-muted-foreground/70">No matching members.</div>
                  ) : (
                    filtered.map((member) => (
                      <AddDomainLeadForMemberButton
                        key={member.id}
                        domainId={domain.id}
                        member={member}
                        onAdded={() => { setOpen(false); setSearch(""); }}
                      />
                    ))
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// Domain-eligibility level (P1/P2/P3) shown as a colored badge that is itself
// the level picker: the native <select> sits invisibly on top so a click opens
// the level menu, while the styled badge underneath renders the current value.
// Transparent background — distinguished by text color only (P1 muted, P2 teal,
// P3 coral).
const LEVEL_BADGE: Record<Level, string> = {
  P1: "text-muted-foreground",
  P2: "text-accent-teal",
  P3: "text-accent-coral",
};

function EligibilityLevelSelect({
  domainId,
  userId,
  level,
}: {
  domainId: string;
  userId: string;
  level: Level;
}) {
  const fetcher = useFetcher();
  // Optimistic: reflect the just-submitted level while the request is in flight.
  const pending = fetcher.formData?.get("level");
  const shown = (typeof pending === "string" ? pending : level) as Level;
  return (
    <fetcher.Form method="post" className="relative inline-flex">
      <input type="hidden" name="intent" value="set-eligibility-level" />
      <input type="hidden" name="userId" value={userId} />
      <input type="hidden" name="domainId" value={domainId} />
      <span
        className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-bold leading-none ${LEVEL_BADGE[shown]}`}
        aria-hidden="true"
      >
        {shown}
      </span>
      <select
        name="level"
        value={shown}
        onChange={(e) => fetcher.submit(e.currentTarget.form)}
        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
        aria-label="Eligibility level"
        title="Change level"
      >
        {ALLOWED_LEVELS.map((l) => (
          <option key={l} value={l}>{l}</option>
        ))}
      </select>
    </fetcher.Form>
  );
}

function RemoveEligibilityButton({ eligibilityId }: { eligibilityId: string }) {
  const fetcher = useFetcher();
  return (
    <fetcher.Form method="post" className="inline">
      <input type="hidden" name="intent" value="remove-eligibility" />
      <input type="hidden" name="eligibilityId" value={eligibilityId} />
      <button
        type="submit"
        aria-label="Remove eligibility"
        className="inline-flex items-center justify-center rounded-full p-0.5 text-amber-700/70 hover:text-amber-900 hover:bg-amber-100"
      >
        <X className="w-3 h-3" />
      </button>
    </fetcher.Form>
  );
}

function AddEligibilityForm({
  domainId,
  member,
  onAdded,
}: {
  domainId: string;
  member: Member;
  onAdded: () => void;
}) {
  const fetcher = useFetcher();
  return (
    <fetcher.Form method="post" onSubmit={onAdded} className="flex items-center gap-2 px-3 py-1.5 hover:bg-muted/50">
      <input type="hidden" name="intent" value="add-eligibility" />
      <input type="hidden" name="userId" value={member.id} />
      <input type="hidden" name="domainId" value={domainId} />
      <button type="submit" className="text-left flex-1 text-sm text-foreground/80" name="level" value="P1">
        {memberLabel(member)}
      </button>
      <div className="flex gap-1">
        {ALLOWED_LEVELS.map((l) => (
          <button
            key={l}
            type="submit"
            name="level"
            value={l}
            title={`Assign ${l}`}
            className={`px-1.5 py-0.5 text-[10px] font-bold leading-none rounded border border-border hover:bg-muted/50 ${LEVEL_BADGE[l]}`}
          >
            {l}
          </button>
        ))}
      </div>
    </fetcher.Form>
  );
}

function DomainMembersForDomain({ domain, members }: { domain: DomainWithCounts; members: Member[] }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const assignedUserIds = new Set(domain.eligibilities.map((e) => e.user.id));
  const available = members.filter((m) => !assignedUserIds.has(m.id));
  const q = search.trim().toLowerCase();
  const filtered = q
    ? available.filter((m) => memberLabel(m).toLowerCase().includes(q) || (m.daliEmail ?? "").toLowerCase().includes(q))
    : available;

  return (
    <div className="flex flex-wrap gap-1.5 items-center">
      <span className="text-xs text-muted-foreground/70 mr-1">Members:</span>
      {domain.eligibilities.length === 0 && (
        <span className="text-xs text-muted-foreground/70 italic">none</span>
      )}
      {domain.eligibilities.map((e) => (
        <span
          key={e.id}
          className="inline-flex items-center gap-1.5 pl-2 pr-1 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-900 border border-amber-200"
        >
          {memberLabel(e.user)}
          <EligibilityLevelSelect domainId={domain.id} userId={e.user.id} level={e.level} />
          <RemoveEligibilityButton eligibilityId={e.id} />
        </span>
      ))}

      {available.length > 0 && (
        <div className="relative">
          <button
            type="button"
            onClick={() => setOpen(!open)}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-muted text-muted-foreground hover:bg-muted/70 transition-colors"
          >
            + Member
            <ChevronDown className="w-3 h-3" />
          </button>
          {open && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => { setOpen(false); setSearch(""); }} />
              <div className="absolute left-0 z-20 mt-1 w-80 rounded-md shadow-lg bg-card ring-1 ring-black ring-opacity-5">
                <div className="p-2 border-b border-border">
                  <input
                    type="text"
                    autoFocus
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search members…"
                    className="w-full px-2 py-1 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
                  />
                  <p className="mt-1.5 text-[10px] text-muted-foreground/70">
                    Click a level (P1/P2/P3) to assign. Defaults to P1 if you click the name.
                  </p>
                </div>
                <div className="py-1 max-h-64 overflow-y-auto">
                  {filtered.length === 0 ? (
                    <div className="px-4 py-2 text-sm text-muted-foreground/70">No matching members.</div>
                  ) : (
                    filtered.map((member) => (
                      <AddEligibilityForm
                        key={member.id}
                        domainId={domain.id}
                        member={member}
                        onAdded={() => { setOpen(false); setSearch(""); }}
                      />
                    ))
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function DomainRowItem({
  domain,
  members,
  viewerIsAdmin,
}: {
  domain: DomainWithCounts;
  members: Member[];
  viewerIsAdmin: boolean;
}) {
  const fetcher = useFetcher<{ error?: string }>();
  const inUseBy = describeDomainUsage(domain._count);
  const inUse = inUseBy.length > 0;
  const isDeleting = fetcher.state !== "idle";

  return (
    <li className="flex items-start justify-between gap-3 px-4 py-3.5 transition-colors hover:bg-muted/40">
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
          <span className="font-heading text-sm font-semibold text-foreground">{domain.name}</span>
          {/* Usage is why a domain can't be deleted, so it's stated as the
              reason rather than as a sentence to parse. */}
          {inUse ? (
            <span className="text-xs text-muted-foreground">In use by {inUseBy.join(", ")}</span>
          ) : (
            <span className="rounded-md border border-border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Unused
            </span>
          )}
        </div>
        <DomainLeadsForDomain domain={domain} members={members} />
        <DomainMembersForDomain domain={domain} members={members} />
        {fetcher.data?.error && (
          <span className="text-xs text-destructive">{fetcher.data.error}</span>
        )}
      </div>
      {viewerIsAdmin && (
        <fetcher.Form method="post">
          <input type="hidden" name="intent" value="delete-domain" />
          <input type="hidden" name="domainId" value={domain.id} />
          <Tooltip label="Delete">
            <button
              type="submit"
              disabled={inUse || isDeleting}
              title={inUse ? `Cannot delete — in use by ${inUseBy.join(", ")}` : "Delete domain"}
              aria-label="Delete"
              className="inline-flex items-center justify-center rounded-md border border-border p-1.5 text-muted-foreground transition-colors hover:border-destructive/40 hover:bg-destructive/10 hover:text-destructive disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-border disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          </Tooltip>
        </fetcher.Form>
      )}
    </li>
  );
}

export default function AdminConsoleDomains() {
  const { domains, members, viewerIsAdmin } = useLoaderData<typeof loader>();
  const createFetcher = useFetcher<{ error?: string } | null>();
  const [name, setName] = useState("");
  const isCreating = createFetcher.state !== "idle";
  const wasCreating = useRef(false);

  useEffect(() => {
    if (isCreating) wasCreating.current = true;
    else if (wasCreating.current) {
      wasCreating.current = false;
      if (!createFetcher.data?.error) setName("");
    }
  }, [isCreating, createFetcher.data]);

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-4">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-coral/10 text-accent-coral">
            <Compass className="h-4.5 w-4.5" />
          </span>
          <div className="min-w-0">
            <h1 className="font-heading text-xl font-bold text-foreground">Domains</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              The disciplines members are hired into. Each one carries its own leads and
              eligibility list.
            </p>
          </div>
        </div>

        {viewerIsAdmin && (
          <createFetcher.Form method="post" className="flex flex-wrap items-center gap-2">
            <input type="hidden" name="intent" value="create-domain" />
            <label htmlFor="new-domain-name" className="sr-only">
              New domain name
            </label>
            <input
              id="new-domain-name"
              type="text"
              name="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Add a domain — e.g. Design"
              className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30 sm:max-w-xs"
              disabled={isCreating}
            />
            <button
              type="submit"
              disabled={isCreating || !name.trim()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent-coral px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent-coral/90 disabled:opacity-50"
            >
              <Plus className="h-3.5 w-3.5" />
              Add domain
            </button>
          </createFetcher.Form>
        )}
      </header>

      <div className="overflow-hidden rounded-lg border border-border bg-card shadow-brand-1">
        {createFetcher.data?.error && (
          <div className="border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">
            {createFetcher.data.error}
          </div>
        )}
        <ul className="divide-y divide-border">
          {domains.length === 0 && (
            <li className="px-4 py-12 text-center text-sm text-muted-foreground">
              No domains yet. Add the first one above.
            </li>
          )}
          {domains.map((d) => (
            <DomainRowItem key={d.id} domain={d} members={members} viewerIsAdmin={viewerIsAdmin} />
          ))}
        </ul>
      </div>
    </div>
  );
}
