import { redirect } from "react-router";
import type { Route } from "./+types/admin.members";
import { adminHandle } from "~/admin/adminNav";
import { prisma } from "~/lib/db.server";
import { requireAuth, forbidden } from "~/lib/auth";
import { isAdmin, isCore, currentTerm } from "~/lib/roles";
import { coreCycleTermIds } from "~/lib/core-cycle";
import { logRoleChange, logDomainLeadChange } from "~/admin/lib/access-audit.server";
import { notifyAdminsOfPromotion } from "~/lib/promotion-notify.server";

export const meta: Route.MetaFunction = () => [{ title: "Roles & Permissions · Admin · DALI OS" }];

export const handle = adminHandle("members");

// Role state lives in AdminMembership / CoreAssignment / DomainLeadAssignment.
// Any Core member or Admin may assign Core titles and domain leads; granting
// Admin or Staff is admin-only (enforced inside the action).

// The page itself is Core › Roles & domains (/core/access). This route keeps
// the role-change action that page forwards to.
export function loader({ request }: Route.LoaderArgs) {
  return redirect(`/core/access${new URL(request.url).search}`);
}

const coreTitleLabel = (leadTitle: string | null) =>
  leadTitle ? `Core: ${leadTitle}` : "Core";

export async function action({ request }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  if (!(await isCore(auth.user.sub)))
    return forbidden(request);

  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  const roleLabels = (m: { isStaff: boolean } | null) =>
    m ? (m.isStaff ? ["Admin", "Staff"] : ["Admin"]) : [];

  if (intent === "set-admin") {
    if (!(await isAdmin(auth.user.sub)))
      return forbidden(request);
    const userId = formData.get("userId") as string;
    const value = formData.get("value") === "true";
    const before = await prisma.adminMembership.findUnique({
      where: { userId },
      select: { isStaff: true },
    });
    if (value) {
      await prisma.adminMembership.upsert({
        where: { userId },
        update: {},
        create: { userId, grantedBy: auth.user.sub },
      });
    } else {
      await prisma.adminMembership.deleteMany({ where: { userId } });
    }
    if (value !== !!before) {
      await logRoleChange({
        actorId: auth.user.sub,
        targetUserId: userId,
        before: roleLabels(before),
        after: value ? ["Admin"] : [],
        request,
      });
    }
    return null;
  }

  // Staff implies Admin: marking Staff also grants Admin; un-marking keeps Admin.
  if (intent === "set-staff") {
    if (!(await isAdmin(auth.user.sub)))
      return forbidden(request);
    const userId = formData.get("userId") as string;
    const value = formData.get("value") === "true";
    const before = await prisma.adminMembership.findUnique({
      where: { userId },
      select: { isStaff: true },
    });
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
    if (value !== !!before?.isStaff) {
      await logRoleChange({
        actorId: auth.user.sub,
        targetUserId: userId,
        before: roleLabels(before),
        after: value ? ["Admin", "Staff"] : before ? ["Admin"] : [],
        request,
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
      await logRoleChange({
        actorId: auth.user.sub,
        targetUserId: userId,
        before: [],
        after: [coreTitleLabel(leadTitle)],
        request,
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
    await logRoleChange({
      actorId: auth.user.sub,
      targetUserId: target.userId,
      before: [coreTitleLabel(target.leadTitle)],
      after: [],
      request,
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
    const key = { userId_domainId_termId: { userId, domainId, termId: term.id } };
    const existing = await prisma.domainLeadAssignment.findUnique({
      where: key,
      select: { id: true },
    });
    const assignment = await prisma.domainLeadAssignment.upsert({
      where: key,
      update: {},
      create: { userId, domainId, termId: term.id },
    });
    if (!existing) {
      await logDomainLeadChange({
        kind: "add",
        actorId: auth.user.sub,
        targetUserId: userId,
        domainId,
        assignmentId: assignment.id,
        termId: term.id,
        request,
      });
    }
    return null;
  }

  if (intent === "remove-domain-lead") {
    const assignmentId = formData.get("assignmentId") as string;
    const removed = await prisma.domainLeadAssignment.delete({
      where: { id: assignmentId },
    });
    await logDomainLeadChange({
      kind: "remove",
      actorId: auth.user.sub,
      targetUserId: removed.userId,
      domainId: removed.domainId,
      assignmentId,
      termId: removed.termId,
      request,
    });
    return null;
  }

  return null;
}
