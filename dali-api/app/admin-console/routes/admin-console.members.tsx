import { useState } from "react";
import { redirect, useLoaderData } from "react-router";
import type { Route } from "./+types/admin-console.members";
import { prisma } from "~/lib/db";
import { requireAuth, withAuth } from "~/lib/auth";
import { isAdmin } from "~/lib/roles";
import { Users, Check } from "lucide-react";
import {
  AdminToggle,
  DomainLeadPicker,
  HiringLeadToggle,
} from "~/admin-console/components/admin-console-shared";

export const meta: Route.MetaFunction = () => [{ title: "Members · Admin console · DALI OS" }];

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return withAuth(auth, redirect("/login"));
  const admin = await isAdmin(auth.user.sub);
  if (!admin) return withAuth(auth, redirect("/"));

  const [members, domains] = await Promise.all([
    prisma.dALIMember.findMany({
      include: {
        user: { select: { id: true, firstName: true, lastName: true } },
        domainLeadAssignments: { include: { domain: true } },
      },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    }),
    prisma.domain.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  return withAuth(auth, { members, domains });
}

export async function action({ request }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  const admin = await isAdmin(auth.user.sub);
  if (!admin)
    return withAuth(auth, Response.json({ error: "Forbidden" }, { status: 403 }));

  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  if (intent === "set-admin") {
    const memberId = formData.get("memberId") as string;
    const value = formData.get("value") === "true";
    const member = await prisma.dALIMember.findUniqueOrThrow({
      where: { id: memberId },
      select: { roles: true },
    });
    const roles = value
      ? [...new Set([...member.roles, "Admin" as const])]
      : member.roles.filter((r) => r !== "Admin");
    await prisma.dALIMember.update({ where: { id: memberId }, data: { roles } });
    return withAuth(auth, null);
  }

  if (intent === "set-hiring-lead") {
    const memberId = formData.get("memberId") as string;
    const value = formData.get("value") === "true";
    const member = await prisma.dALIMember.findUniqueOrThrow({
      where: { id: memberId },
      select: { roles: true },
    });
    const roles = value
      ? [...new Set([...member.roles, "HiringLead" as const])]
      : member.roles.filter((r) => r !== "HiringLead");
    await prisma.dALIMember.update({ where: { id: memberId }, data: { roles } });
    return withAuth(auth, null);
  }

  if (intent === "add-domain-lead") {
    const memberId = formData.get("memberId") as string;
    const domainId = formData.get("domainId") as string;
    await prisma.domainLeadAssignment.create({ data: { memberId, domainId } });
    return withAuth(auth, null);
  }

  if (intent === "remove-domain-lead") {
    const assignmentId = formData.get("assignmentId") as string;
    await prisma.domainLeadAssignment.delete({ where: { id: assignmentId } });
    return withAuth(auth, null);
  }

  return withAuth(auth, null);
}

type RoleFilter = "all" | "admin" | "hiringLead";

export default function AdminConsoleMembers() {
  const { members, domains } = useLoaderData<typeof loader>();
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");

  const filtered = members.filter((m) => {
    const name = `${m.firstName ?? ""} ${m.lastName ?? ""}`.toLowerCase();
    const email = (m.daliEmail ?? "").toLowerCase();
    const q = search.toLowerCase();
    if (q && !name.includes(q) && !email.includes(q)) return false;
    if (roleFilter === "admin" && !m.roles.includes("Admin")) return false;
    if (roleFilter === "hiringLead" && !m.roles.includes("HiringLead")) return false;
    return true;
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Users className="w-6 h-6 text-foreground/80" />
          <h1 className="text-2xl font-bold text-foreground">DALI Members</h1>
          <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-muted text-muted-foreground">
            {filtered.length}{filtered.length !== members.length ? ` of ${members.length}` : ""} members
          </span>
        </div>
        <div className="flex items-center gap-3">
          <div role="group" aria-label="Filter members by role" className="flex rounded-md border border-border overflow-hidden text-sm">
            {(["all", "admin", "hiringLead"] as RoleFilter[]).map((f) => (
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
                {f === "all" ? "All" : f === "admin" ? "Admins" : "Hiring Leads"}
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
            className="w-56 px-3 py-2 text-sm border border-border rounded-md bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
      </div>

      <div className="bg-card border border-border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/50">
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Name</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">DALI Email</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Linked User</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Admin</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Hiring Lead</th>
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
                  {member.user ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                      <Check className="w-3 h-3" />
                      {member.user.firstName} {member.user.lastName}
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground/70">No account</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <AdminToggle member={member} />
                </td>
                <td className="px-4 py-3">
                  <HiringLeadToggle member={member} />
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
