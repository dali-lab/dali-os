import { useState } from "react";
import { redirect, useLoaderData, useFetcher } from "react-router";
import type { Route } from "./+types/admin-console";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isAdmin, isHiringLead } from "~/lib/roles";
import { Shield, Users, ChevronDown, X, Check } from "lucide-react";

// ─── Loader ──────────────────────────────────────────────────────────────────

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");
  if (!(await isAdmin(auth.user.sub)) && !(await isHiringLead(auth.user.sub))) return redirect("/");

  const [members, domains] = await Promise.all([
    prisma.dALIMember.findMany({
      include: {
        user: { select: { id: true, firstName: true, lastName: true } },
        domainLeadAssignments: { include: { domain: true } },
      },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    }),
    prisma.domain.findMany({ orderBy: { name: "asc" } }),
  ]);

  return { members, domains };
}

// ─── Action ──────────────────────────────────────────────────────────────────

export async function action({ request }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  if (!(await isAdmin(auth.user.sub)) && !(await isHiringLead(auth.user.sub)))
    return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 });

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
    return null;
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
    return null;
  }

  if (intent === "add-domain-lead") {
    const memberId = formData.get("memberId") as string;
    const domainId = formData.get("domainId") as string;
    await prisma.domainLeadAssignment.create({ data: { memberId, domainId } });
    return null;
  }

  if (intent === "remove-domain-lead") {
    const assignmentId = formData.get("assignmentId") as string;
    await prisma.domainLeadAssignment.delete({ where: { id: assignmentId } });
    return null;
  }

  return null;
}

// ─── Component ───────────────────────────────────────────────────────────────

interface DomainRow {
  id: string;
  name: string;
}

interface DomainLeadAssignment {
  id: string;
  domain: DomainRow;
}

interface Member {
  id: string;
  firstName: string | null;
  lastName: string | null;
  daliEmail: string | null;
  roles: string[];
  user: { id: string; firstName: string; lastName: string } | null;
  domainLeadAssignments: DomainLeadAssignment[];
}

type Domain = DomainRow;

function RemoveDomainLeadButton({ assignmentId }: { assignmentId: string }) {
  const fetcher = useFetcher();
  return (
    <fetcher.Form method="post" className="inline">
      <input type="hidden" name="intent" value="remove-domain-lead" />
      <input type="hidden" name="assignmentId" value={assignmentId} />
      <button type="submit" className="hover:text-purple-600 ml-0.5">
        <X className="w-3 h-3" />
      </button>
    </fetcher.Form>
  );
}

function AddDomainLeadButton({ memberId, domain, onAdded }: { memberId: string; domain: Domain; onAdded: () => void }) {
  const fetcher = useFetcher();
  return (
    <fetcher.Form method="post" onSubmit={onAdded}>
      <input type="hidden" name="intent" value="add-domain-lead" />
      <input type="hidden" name="memberId" value={memberId} />
      <input type="hidden" name="domainId" value={domain.id} />
      <button type="submit" className="w-full text-left px-4 py-2 text-sm text-foreground/80 hover:bg-muted/50">
        {domain.name}
      </button>
    </fetcher.Form>
  );
}

function DomainLeadPicker({
  member,
  domains,
  existingAssignments,
}: {
  member: Member;
  domains: Domain[];
  existingAssignments: Member["domainLeadAssignments"];
}) {
  const [open, setOpen] = useState(false);
  const assignedDomainIds = new Set(existingAssignments.map((a) => a.domain.id));
  const available = domains.filter((d) => !assignedDomainIds.has(d.id));

  return (
    <div className="flex flex-wrap gap-1.5 items-center">
      {existingAssignments.map((assignment) => (
        <span
          key={assignment.id}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-800"
        >
          {assignment.domain.name}
          <RemoveDomainLeadButton assignmentId={assignment.id} />
        </span>
      ))}

      {available.length > 0 && (
        <div className="relative">
          <button
            onClick={() => setOpen(!open)}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-muted text-muted-foreground hover:bg-muted"
          >
            + Domain
            <ChevronDown className="w-3 h-3" />
          </button>
          {open && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
              <div className="absolute left-0 z-20 mt-1 w-40 rounded-md shadow-lg bg-card ring-1 ring-black ring-opacity-5">
                <div className="py-1">
                  {available.map((domain) => (
                    <AddDomainLeadButton
                      key={domain.id}
                      memberId={member.id}
                      domain={domain}
                      onAdded={() => setOpen(false)}
                    />
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function AdminToggle({ member }: { member: Member }) {
  const fetcher = useFetcher();
  // Optimistically reflect in-flight submission
  const submittedValue = fetcher.formData?.get("value");
  const isAdminMember = submittedValue != null
    ? submittedValue === "true"
    : member.roles.includes("Admin");

  return (
    <fetcher.Form method="post">
      <input type="hidden" name="intent" value="set-admin" />
      <input type="hidden" name="memberId" value={member.id} />
      <input type="hidden" name="value" value={String(!isAdminMember)} />
      <button
        type="submit"
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
          isAdminMember
            ? "bg-blue-100 text-blue-800 hover:bg-blue-200"
            : "bg-muted text-muted-foreground hover:bg-muted"
        }`}
      >
        {isAdminMember ? <Check className="w-3 h-3" /> : <Shield className="w-3 h-3" />}
        {isAdminMember ? "Admin" : "Set Admin"}
      </button>
    </fetcher.Form>
  );
}

function HiringLeadToggle({ member }: { member: Member }) {
  const fetcher = useFetcher();
  const submittedValue = fetcher.formData?.get("value");
  const isHiringLead = submittedValue != null
    ? submittedValue === "true"
    : member.roles.includes("HiringLead");

  return (
    <fetcher.Form method="post">
      <input type="hidden" name="intent" value="set-hiring-lead" />
      <input type="hidden" name="memberId" value={member.id} />
      <input type="hidden" name="value" value={String(!isHiringLead)} />
      <button
        type="submit"
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
          isHiringLead
            ? "bg-green-100 text-green-800 hover:bg-green-200"
            : "bg-muted text-muted-foreground hover:bg-muted"
        }`}
      >
        {isHiringLead ? <Check className="w-3 h-3" /> : <Shield className="w-3 h-3" />}
        {isHiringLead ? "Hiring Lead" : "Set Hiring Lead"}
      </button>
    </fetcher.Form>
  );
}

type RoleFilter = "all" | "admin" | "hiringLead";

export default function AdminConsole() {
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
