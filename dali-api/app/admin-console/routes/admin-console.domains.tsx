import { useEffect, useRef, useState } from "react";
import { redirect, useLoaderData, useFetcher } from "react-router";
import type { Route } from "./+types/admin-console.domains";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isAdmin, currentTerm } from "~/lib/roles";
import { describeDomainUsage } from "./api.domains.$domainId";
import { ChevronDown, Trash2, Plus } from "lucide-react";
import {
  type DomainWithCounts,
  type Member,
  memberLabel,
  RemoveDomainLeadButton,
} from "~/admin-console/components/admin-console-shared";

export const meta: Route.MetaFunction = () => [{ title: "Domains · Admin console · DALI OS" }];

// Phase 2 rewrite: domain-lead assignments now key off User.id (not
// DALIMember.id) and require a termId. Lead picker lists Users with a
// DALIMember row (lab members).

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");
  const admin = await isAdmin(auth.user.sub);
  if (!admin) return redirect("/admin-console/members");

  const [users, domains] = await Promise.all([
    prisma.user.findMany({
      where: { daliMember: { isNot: null } },
      include: {
        adminMembership: { select: { id: true } },
        coreAssignments: { select: { termId: true, leadTitle: true } },
        domainLeadAssignmentsAsUser: { include: { domain: true } },
      },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
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
        _count: {
          select: {
            challengeVersions: true,
            applicationCycles: true,
            domainLeadAssignments: true,
            cycleReviewers: true,
            cycleInterviewers: true,
            delibsSessions: true,
          },
        },
      },
    }),
  ]);

  const members: Member[] = users.map((u) => ({
    id: u.id,
    firstName: u.firstName,
    lastName: u.lastName,
    daliEmail: u.daliEmail,
    isLabMember: true,
    isAdmin: u.adminMembership !== null,
    isCore: u.coreAssignments.length > 0,
    domainLeadAssignments: u.domainLeadAssignmentsAsUser.map((a) => ({
      id: a.id,
      domain: { id: a.domain.id, name: a.domain.displayName },
    })),
  }));

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
    _count: d._count,
  }));

  return { members, domains: domainsForView };
}

export async function action({ request }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  const admin = await isAdmin(auth.user.sub);
  if (!admin) return Response.json({ error: "Forbidden" }, { status: 403 });

  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  if (intent === "create-domain") {
    const name = String(formData.get("name") ?? "").trim();
    if (!name) return Response.json({ error: "Name is required" }, { status: 400 });
    // Phase 2: code + displayName required. Derive code from the name by
    // stripping non-alnum (admin can rename later). displayName mirrors
    // name on create; both editable post-create.
    const code = name.replace(/[^A-Za-z0-9]/g, "") || "Domain";
    await prisma.domain.create({
      data: { name, code, displayName: name },
    });
    return null;
  }

  if (intent === "delete-domain") {
    const domainId = String(formData.get("domainId") ?? "");
    if (!domainId) return Response.json({ error: "domainId is required" }, { status: 400 });

    const result = await prisma.$transaction(async (tx) => {
      const domain = await tx.domain.findUnique({
        where: { id: domainId },
        include: {
          _count: {
            select: {
              challengeVersions: true,
              applicationCycles: true,
              domainLeadAssignments: true,
              cycleReviewers: true,
              cycleInterviewers: true,
              delibsSessions: true,
            },
          },
        },
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
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-muted text-muted-foreground hover:bg-muted"
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
                    className="w-full px-2 py-1 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
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

function DomainRowItem({ domain, members }: { domain: DomainWithCounts; members: Member[] }) {
  const fetcher = useFetcher<{ error?: string }>();
  const inUseBy = describeDomainUsage(domain._count);
  const inUse = inUseBy.length > 0;
  const isDeleting = fetcher.state !== "idle";

  return (
    <li className="px-4 py-3 flex items-center justify-between gap-3">
      <div className="flex flex-col gap-1 min-w-0 flex-1">
        <span className="text-sm font-medium text-foreground">{domain.name}</span>
        {inUse ? (
          <span className="text-xs text-muted-foreground">In use by {inUseBy.join(", ")}</span>
        ) : (
          <span className="text-xs text-muted-foreground/70">Not in use</span>
        )}
        <DomainLeadsForDomain domain={domain} members={members} />
        {fetcher.data?.error && (
          <span className="text-xs text-red-700">{fetcher.data.error}</span>
        )}
      </div>
      <fetcher.Form method="post">
        <input type="hidden" name="intent" value="delete-domain" />
        <input type="hidden" name="domainId" value={domain.id} />
        <button
          type="submit"
          disabled={inUse || isDeleting}
          title={inUse ? `Cannot delete — in use by ${inUseBy.join(", ")}` : "Delete domain"}
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium bg-red-50 text-red-700 hover:bg-red-100 disabled:bg-muted disabled:text-muted-foreground/60 disabled:cursor-not-allowed"
        >
          <Trash2 className="w-3 h-3" />
          Delete
        </button>
      </fetcher.Form>
    </li>
  );
}

export default function AdminConsoleDomains() {
  const { domains, members } = useLoaderData<typeof loader>();
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
    <div className="space-y-6">
      <div className="bg-card border border-border rounded-lg overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/50">
          <h2 className="text-sm font-medium text-muted-foreground">Domains ({domains.length})</h2>
          <createFetcher.Form method="post" className="flex items-center gap-2">
            <input type="hidden" name="intent" value="create-domain" />
            <label htmlFor="new-domain-name" className="sr-only">New domain name</label>
            <input
              id="new-domain-name"
              type="text"
              name="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="New domain name"
              className="px-2 py-1 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              disabled={isCreating}
            />
            <button
              type="submit"
              disabled={isCreating || !name.trim()}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium bg-gray-900 text-white hover:bg-gray-800 disabled:opacity-50"
            >
              <Plus className="w-3 h-3" />
              Create
            </button>
          </createFetcher.Form>
        </div>
        {createFetcher.data?.error && (
          <div className="px-4 py-2 text-sm text-red-700 bg-red-50 border-b border-red-200">
            {createFetcher.data.error}
          </div>
        )}
        <ul className="divide-y divide-gray-100">
          {domains.length === 0 && (
            <li className="px-4 py-6 text-center text-sm text-muted-foreground/70">No domains yet.</li>
          )}
          {domains.map((d) => (
            <DomainRowItem key={d.id} domain={d} members={members} />
          ))}
        </ul>
      </div>
    </div>
  );
}
