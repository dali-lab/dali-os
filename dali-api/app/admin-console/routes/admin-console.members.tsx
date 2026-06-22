import { useState } from "react";
import { redirect, useLoaderData } from "react-router";
import type { Route } from "./+types/admin-console.members";
import { prisma } from "~/lib/db";
import { requireAuth, forbidden } from "~/lib/auth";
import { isAdmin, isCore, isAdminViaEnv, currentTerm } from "~/lib/roles";
import { LAB_MEMBER_WHERE, MEMBER_LIST_ORDER_BY } from "~/lib/prisma-shapes";
import { coreCycleTermIds } from "~/lib/core-cycle";
import { Users, Check } from "lucide-react";
import {
  AdminToggle,
  CorePicker,
  DomainLeadPicker,
  type Member,
} from "~/admin-console/components/admin-console-shared";

export const meta: Route.MetaFunction = () => [{ title: "Roles & Permissions · Admin · DALI OS" }];

// Phase 2 rewrite: role state lives in AdminMembership / CoreAssignment /
// DomainLeadAssignment instead of DALIMember.roles[]. The admin page now
// lists Users (filtered to those with a DALIMember row, i.e. lab members)
// and presents per-user toggles backed by row insert/delete on the three
// assignment tables.
//
// Access: any Core member or Admin may view and assign Core titles / Domain
// Leads. Granting Admin itself is admin-only (enforced inside the action).

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");
  if (!(await isCore(auth.user.sub))) return redirect("/");
  const viewerIsAdmin = await isAdmin(auth.user.sub);

  const [users, domains, term] = await Promise.all([
    prisma.user.findMany({
      where: { ...LAB_MEMBER_WHERE },
      include: {
        daliMember: { select: { id: true } },
        adminMembership: { select: { id: true } },
        coreAssignments: { select: { id: true, termId: true, leadTitle: true } },
        domainLeadAssignmentsAsUser: { include: { domain: true } },
      },
      orderBy: MEMBER_LIST_ORDER_BY,
    }),
    prisma.domain.findMany({
      where: { active: true },
      orderBy: { displayName: "asc" },
      select: { id: true, name: true, displayName: true },
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
      isLabMember: u.daliMember !== null,
      isAdmin: isAdminUser,
      isCore: isAdminUser || currentCore.length > 0,
      coreAssignments: currentCore.map((a) => ({ id: a.id, leadTitle: a.leadTitle })),
      domainLeadAssignments: u.domainLeadAssignmentsAsUser.map((a) => ({
        id: a.id,
        domain: { id: a.domain.id, name: a.domain.displayName },
      })),
    };
  });

  return {
    members,
    domains: domains.map((d) => ({ id: d.id, name: d.displayName })),
    viewerIsAdmin,
  };
}

export async function action({ request }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  if (!(await isCore(auth.user.sub)))
    return forbidden(request);

  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  // Admin-promotion is the only Admin-gated mutation on this page.
  if (intent === "set-admin") {
    if (!(await isAdmin(auth.user.sub)))
      return forbidden(request);
    const userId = formData.get("userId") as string;
    const value = formData.get("value") === "true";
    if (value) {
      await prisma.adminMembership.upsert({
        where: { userId },
        update: {},
        create: { userId, grantedBy: auth.user.sub },
      });
    } else {
      await prisma.adminMembership.deleteMany({ where: { userId } });
    }
    return null;
  }

  // Free-text Core title for the current Core cycle. A member can hold
  // multiple titles in the same term (schema-side: no unique on
  // (userId, termId, leadTitle)). App-level guard: ignore exact-title
  // duplicates rather than 409.
  //
  // The Core "cycle" runs Spring → following Winter (4 terms). We materialize
  // one CoreAssignment row per term in the cycle so every reader (payroll,
  // search, isCore) can query by termId and get the same answer without
  // re-deriving cycle math. See lib/core-cycle.ts.
  if (intent === "add-core-title") {
    const userId = formData.get("userId") as string;
    const rawTitle = String(formData.get("leadTitle") ?? "").trim();
    const leadTitle = rawTitle === "" ? null : rawTitle.slice(0, 80);
    const term = await currentTerm();
    if (!term) {
      return Response.json(
        { error: "No current Term — run npm run db:seed:v0-reference" },
        { status: 500 },
      );
    }
    const cycleTermIds = await coreCycleTermIds(term.id);
    const existing = await prisma.coreAssignment.findMany({
      where: { userId, termId: { in: cycleTermIds }, leadTitle },
      select: { termId: true },
    });
    const alreadyCovered = new Set(existing.map((e) => e.termId));
    const missing = cycleTermIds.filter((tid) => !alreadyCovered.has(tid));
    if (missing.length > 0) {
      await prisma.coreAssignment.createMany({
        data: missing.map((termId) => ({ userId, termId, leadTitle })),
      });
    }
    return null;
  }

  // Remove this Core title for the entire cycle the assignment belongs to —
  // not just the single term the row was indexed by. (Multiple CoreAssignment
  // rows fan out across the cycle on add; clearing all of them keeps the
  // data consistent across surfaces.)
  if (intent === "remove-core-title") {
    const assignmentId = formData.get("assignmentId") as string;
    const target = await prisma.coreAssignment.findUnique({
      where: { id: assignmentId },
      select: { userId: true, termId: true, leadTitle: true },
    });
    if (!target) return null;
    const cycleTermIds = await coreCycleTermIds(target.termId);
    await prisma.coreAssignment.deleteMany({
      where: {
        userId: target.userId,
        leadTitle: target.leadTitle,
        termId: { in: cycleTermIds },
      },
    });
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

type RoleFilter = "all" | "admin" | "core";

export default function AdminConsoleMembers() {
  const { members, domains, viewerIsAdmin } = useLoaderData<typeof loader>();
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");

  const filtered = members.filter((m) => {
    const name = `${m.firstName} ${m.lastName}`.toLowerCase();
    const email = (m.daliEmail ?? "").toLowerCase();
    const q = search.toLowerCase();
    if (q && !name.includes(q) && !email.includes(q)) return false;
    if (roleFilter === "admin" && !m.isAdmin) return false;
    if (roleFilter === "core" && !m.isCore) return false;
    return true;
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Users className="w-6 h-6 text-foreground/80" />
          <h1 className="text-2xl font-bold text-foreground">Roles & Permissions</h1>
          <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-muted text-muted-foreground">
            {filtered.length}{filtered.length !== members.length ? ` of ${members.length}` : ""} members
          </span>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
          <div role="group" aria-label="Filter members by role" className="flex rounded-md border border-border overflow-hidden text-sm">
            {(["all", "admin", "core"] as RoleFilter[]).map((f) => (
              <button
                key={f}
                onClick={() => setRoleFilter(f)}
                aria-pressed={roleFilter === f}
                className={`px-3 py-1.5 font-medium transition-colors ${
                  roleFilter === f
                    ? "bg-gray-900 text-white"
                    : "bg-card text-muted-foreground hover:bg-muted/50"
                }`}
              >
                {f === "all" ? "All" : f === "admin" ? "Admins" : "Core"}
              </button>
            ))}
          </div>
          <label htmlFor="member-search" className="sr-only">Search members by name or email</label>
          <input
            id="member-search"
            type="text"
            placeholder="Search by name or email…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full sm:w-56 px-3 py-2 text-base sm:text-sm border border-border rounded-md bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
      </div>

      <div className="bg-card border border-border rounded-lg overflow-x-auto">
        <table className="w-full text-sm min-w-[760px]">
          <thead>
            <tr className="border-b border-border bg-muted/50">
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Name</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">DALI Email</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Lab Member</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Admin</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Core</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Domain Lead</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground/70">
                  <span className="sr-only">Table empty: </span>No members found.
                </td>
              </tr>
            )}
            {filtered.map((member) => (
              <tr key={member.id} className="hover:bg-muted/50">
                <td className="px-4 py-3 font-medium text-foreground">
                  {member.firstName} {member.lastName}
                </td>
                <td className="px-4 py-3 text-muted-foreground">{member.daliEmail ?? "—"}</td>
                <td className="px-4 py-3">
                  {member.isLabMember ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                      <Check className="w-3 h-3" /> Yes
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground/70">No</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <AdminToggle member={member} disabled={!viewerIsAdmin} />
                </td>
                <td className="px-4 py-3">
                  <CorePicker member={member} />
                </td>
                <td className="px-4 py-3">
                  <DomainLeadPicker
                    member={member}
                    domains={domains}
                    existingAssignments={member.domainLeadAssignments}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
