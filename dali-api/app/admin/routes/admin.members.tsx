import { regroupRedirect } from "~/core/lib/regroup-redirect.server";
import { useState } from "react";
import { redirect, useLoaderData } from "react-router";
import type { Route } from "./+types/admin.members";
import { adminHandle } from "~/admin/adminNav";
import { prisma } from "~/lib/db";
import { requireAuth, forbidden } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { isAdmin, isCore, isAdminViaEnv, currentTerm } from "~/lib/roles";
import { LAB_MEMBER_WHERE, MEMBER_LIST_ORDER_BY } from "~/lib/prisma-shapes";
import { coreCycleTermIds } from "~/lib/core-cycle";
import { notifyAdminsOfPromotion } from "~/lib/promotion-notify.server";
import { resolvePhotoUrl } from "~/lib/photo";
import { Avatar } from "~/components/ui/Avatar";
import { Users, Shield, Briefcase, Crown, Compass } from "lucide-react";
import {
  AdminToggle,
  StaffToggle,
  CorePicker,
  DomainLeadPicker,
  type Member,
} from "~/admin/components/admin-shared";

export const meta: Route.MetaFunction = () => [{ title: "Roles & Permissions · Admin · DALI OS" }];

export const handle = adminHandle("members");

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
  if (!auth.ok) return redirectToLogin(request);
  const regrouped = await regroupRedirect(
    request,
    auth.user.sub,
    "/admin/members",
    "/core/access/roles",
  );
  if (regrouped) return regrouped;
  if (!(await isCore(auth.user.sub))) return redirect("/");
  const viewerIsAdmin = await isAdmin(auth.user.sub);

  const [users, domains, term] = await Promise.all([
    prisma.user.findMany({
      where: { ...LAB_MEMBER_WHERE },
      include: {
        daliMember: { select: { id: true } },
        adminMembership: { select: { id: true, isStaff: true } },
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

  const photoUrls = new Map(
    await Promise.all(
      users.map(async (u) => [u.id, await resolvePhotoUrl(u.photoUrl)] as const),
    ),
  );

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
      photoUrl: photoUrls.get(u.id) ?? null,
      isLabMember: u.daliMember !== null,
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

  // Staff ⊂ Admin: marking Staff upserts the AdminMembership with isStaff=true
  // (granting Admin in the same action); un-marking clears the flag but keeps
  // Admin. Admin-gated, like set-admin.
  if (intent === "set-staff") {
    if (!(await isAdmin(auth.user.sub)))
      return forbidden(request);
    const userId = formData.get("userId") as string;
    const value = formData.get("value") === "true";
    if (value) {
      await prisma.adminMembership.upsert({
        where: { userId },
        update: { isStaff: true },
        create: { userId, grantedBy: auth.user.sub, isStaff: true },
      });
    } else {
      await prisma.adminMembership.updateMany({
        where: { userId },
        data: { isStaff: false },
      });
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
    // A new Core title for the current term is a pay-affecting promotion — tell
    // admins (issue #1001). Skip when they already held this title this term.
    if (!alreadyCovered.has(term.id)) {
      void notifyAdminsOfPromotion({
        userId,
        actorId: auth.user.sub,
        summary: leadTitle ? `joined Core as ${leadTitle}` : "joined Core",
      }).catch((err) => console.error("promotion notify (core) failed", err));
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

  // Counts drive the filter chips, so each one states its own size before you
  // click it — the old segmented control gave no sense of what you'd get.
  const counts = {
    all: members.length,
    admin: members.filter((m) => m.isAdmin).length,
    core: members.filter((m) => m.isCore).length,
    leads: members.filter((m) => m.domainLeadAssignments.length > 0).length,
  };

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-4">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-coral/10 text-accent-coral">
            <Users className="h-4.5 w-4.5" />
          </span>
          <div className="min-w-0">
            <h1 className="font-heading text-xl font-bold text-foreground">Roles &amp; permissions</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Who holds Admin, Staff, Core and Domain Lead this term. Changes take effect
              immediately.
            </p>
          </div>
        </div>

        {/* Role census. Reads as the page's summary and as its filter — the two
            were the same question asked twice before. */}
        <div className="flex flex-wrap items-center gap-2">
          {(
            [
              ["all", "Everyone", counts.all, Users],
              ["admin", "Admins", counts.admin, Shield],
              ["core", "Core", counts.core, Crown],
            ] as const
          ).map(([key, label, count, Icon]) => {
            const active = roleFilter === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setRoleFilter(key)}
                aria-pressed={active}
                className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
                  active
                    ? "border-accent-coral bg-accent-coral/10 text-accent-coral"
                    : "border-border bg-card text-muted-foreground hover:bg-muted"
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
                <span className={`tabular-nums ${active ? "" : "text-muted-foreground/70"}`}>
                  {count}
                </span>
              </button>
            );
          })}
          <span className="ml-auto text-xs text-muted-foreground">
            {counts.leads} domain {counts.leads === 1 ? "lead" : "leads"}
          </span>
        </div>

        <div>
          <label htmlFor="member-search" className="sr-only">
            Search members by name or email
          </label>
          <input
            id="member-search"
            type="search"
            placeholder="Search by name or email…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-base text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30 sm:max-w-sm sm:text-sm"
          />
        </div>
      </header>

      {/* One row per member rather than a 7-column matrix: at seven columns of
          controls the table needed 860px and scrolled sideways on every laptop.
          Identity on the left, the permissions that person actually holds on the
          right, wrapping instead of scrolling. */}
      <div className="overflow-hidden rounded-lg border border-border bg-card shadow-brand-1">
        {filtered.length === 0 ? (
          <p className="px-4 py-12 text-center text-sm text-muted-foreground">
            {search || roleFilter !== "all"
              ? "No members match that search."
              : "No lab members yet."}
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {filtered.map((member) => (
              <MemberRow
                key={member.id}
                member={member}
                domains={domains}
                viewerIsAdmin={viewerIsAdmin}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function MemberRow({
  member,
  domains,
  viewerIsAdmin,
}: {
  member: Member;
  domains: { id: string; name: string }[];
  viewerIsAdmin: boolean;
}) {
  const name = `${member.firstName} ${member.lastName}`.trim();
  // A one-line summary of what this person holds, so the row is readable
  // before you parse the controls next to it.
  const held = [
    member.isAdmin && "Admin",
    member.isStaff && "Staff",
    member.isCore && "Core",
    member.domainLeadAssignments.length > 0 &&
      `Lead · ${member.domainLeadAssignments.map((a) => a.domain.name).join(", ")}`,
  ].filter(Boolean) as string[];

  return (
    <li className="flex flex-col gap-3 px-4 py-3.5 transition-colors hover:bg-muted/40 lg:flex-row lg:items-start lg:gap-6">
      <div className="flex min-w-0 items-center gap-3 lg:w-72 lg:shrink-0">
        <Avatar photoUrl={member.photoUrl} name={name} size="sm" userId={member.id} />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-foreground">{name}</p>
          <p className="truncate text-xs text-muted-foreground">
            {member.daliEmail ?? "No DALI email"}
          </p>
          {held.length > 0 && (
            <p className="mt-0.5 truncate text-[11px] text-accent-coral">{held.join(" · ")}</p>
          )}
        </div>
        {!member.isLabMember && (
          <span className="ml-auto shrink-0 rounded-md border border-border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Not a member
          </span>
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-wrap items-start gap-x-5 gap-y-3">
        <ControlCell label="Access" icon={Shield}>
          <div className="flex flex-wrap items-center gap-1.5">
            <AdminToggle member={member} disabled={!viewerIsAdmin} />
            <StaffToggle member={member} disabled={!viewerIsAdmin} />
          </div>
        </ControlCell>
        <ControlCell label="Core" icon={Crown}>
          <CorePicker member={member} />
        </ControlCell>
        <ControlCell label="Domain lead" icon={Compass}>
          <DomainLeadPicker
            member={member}
            domains={domains}
            existingAssignments={member.domainLeadAssignments}
          />
        </ControlCell>
      </div>
    </li>
  );
}

/** Labelled slot for one group of role controls. The label is what the old
 *  table header used to carry; keeping it per-row is what lets the header go. */
function ControlCell({
  label,
  icon: Icon,
  children,
}: {
  label: string;
  icon: typeof Shield;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">
        <Icon className="h-3 w-3" />
        {label}
      </span>
      {children}
    </div>
  );
}
