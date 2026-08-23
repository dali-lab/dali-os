import { prisma } from "~/lib/db";
import { logAuditEvent } from "~/lib/audit";
import type { Prisma } from "~/generated/prisma/client";

// Single source of truth for what an "active" partnership window means:
// startedAt unset-or-past AND endedAt unset-or-future. Archived projects are
// excluded separately (spec: partner access ends on archive) — compose with
// `project: { status: { not: "Archived" } }` where the query starts from
// ProjectPartner.
export function activeProjectPartnerWhere(
  now = new Date(),
): Prisma.ProjectPartnerWhereInput {
  return {
    AND: [
      { OR: [{ startedAt: null }, { startedAt: { lte: now } }] },
      { OR: [{ endedAt: null }, { endedAt: { gt: now } }] },
    ],
  };
}

// Projects a partner org may currently see in the portal.
export function partnerProjectsWhere(
  partnerOrgId: string,
  now = new Date(),
): Prisma.ProjectWhereInput {
  return {
    status: { not: "Archived" },
    partners: { some: { partnerOrgId, ...activeProjectPartnerWhere(now) } },
  };
}

// True iff `userSub` is a partner-portal account (has a PartnerContact row).
// Used to mark a partner's collab connection to a shared document read-only —
// they may view and comment, but the body is the team's to edit.
export async function isPartnerUser(userSub: string): Promise<boolean> {
  const row = await prisma.partnerContact.findUnique({
    where: { userId: userSub },
    select: { id: true },
  });
  return row !== null;
}

// Current org ids the signed-in partner account belongs to (memberships that
// haven't ended). Empty for a fresh applicant / logged inquiry with no org yet.
export async function partnerOrgIdsForUser(userSub: string): Promise<string[]> {
  const contact = await prisma.partnerContact.findUnique({
    where: { userId: userSub },
    select: { memberships: { where: { endedAt: null }, select: { orgId: true } } },
  });
  return contact?.memberships.map((m) => m.orgId) ?? [];
}

// Projects any of the account's orgs may currently see in the portal.
export function partnerProjectsWhereForOrgs(
  orgIds: string[],
  now = new Date(),
): Prisma.ProjectWhereInput {
  return {
    status: { not: "Archived" },
    partners: {
      some: { partnerOrgId: { in: orgIds }, ...activeProjectPartnerWhere(now) },
    },
  };
}

// True iff `userSub`'s account holds a membership whose org has an active
// ProjectPartner link to a non-archived `projectId`. Used by route loaders and
// by authorizeCollabDoc, so this module must stay prisma-only.
export async function partnerHasProjectAccess(
  userSub: string,
  projectId: string,
): Promise<boolean> {
  const orgIds = await partnerOrgIdsForUser(userSub);
  if (orgIds.length === 0) return false;
  const link = await prisma.projectPartner.findFirst({
    where: {
      projectId,
      partnerOrgId: { in: orgIds },
      ...activeProjectPartnerWhere(),
      project: { status: { not: "Archived" } },
    },
    select: { id: true },
  });
  return link !== null;
}

// Link/unlink helpers shared by the internal org page and the project hub so
// validation and audit behavior cannot drift between the two surfaces.

type ActorContext = { actorUserId: string; request?: Request };

export async function linkProjectPartner(
  params: { projectId: string; partnerOrgId: string; startedAt?: Date | null },
  ctx: ActorContext,
): Promise<{ id: string } | { error: string }> {
  const project = await prisma.project.findUnique({
    where: { id: params.projectId },
    select: { status: true },
  });
  if (!project) return { error: "Project not found" };
  if (project.status === "Archived") {
    return { error: "Archived projects cannot be linked to a partner" };
  }
  try {
    const link = await prisma.projectPartner.create({
      data: {
        projectId: params.projectId,
        partnerOrgId: params.partnerOrgId,
        startedAt: params.startedAt ?? new Date(),
      },
      select: { id: true },
    });
    await logAuditEvent({
      action: "partner.project.link",
      userId: ctx.actorUserId,
      targetId: link.id,
      metadata: { projectId: params.projectId, partnerOrgId: params.partnerOrgId },
      request: ctx.request,
    });
    return link;
  } catch (e) {
    if ((e as { code?: string })?.code === "P2002") {
      return { error: "This organization is already linked to that project" };
    }
    throw e;
  }
}

export async function updateProjectPartnerDates(
  params: { projectPartnerId: string; startedAt?: Date | null; endedAt?: Date | null },
  ctx: ActorContext,
): Promise<{ id: string } | { error: string }> {
  const existing = await prisma.projectPartner.findUnique({
    where: { id: params.projectPartnerId },
    select: { id: true, projectId: true, partnerOrgId: true },
  });
  if (!existing) return { error: "Partnership not found" };
  await prisma.projectPartner.update({
    where: { id: params.projectPartnerId },
    data: { startedAt: params.startedAt, endedAt: params.endedAt },
  });
  await logAuditEvent({
    action: "partner.project.update",
    userId: ctx.actorUserId,
    targetId: existing.id,
    metadata: {
      projectId: existing.projectId,
      partnerOrgId: existing.partnerOrgId,
      startedAt: params.startedAt?.toISOString() ?? null,
      endedAt: params.endedAt?.toISOString() ?? null,
    },
    request: ctx.request,
  });
  return { id: existing.id };
}

export async function unlinkProjectPartner(
  projectPartnerId: string,
  ctx: ActorContext,
): Promise<{ id: string } | { error: string }> {
  const existing = await prisma.projectPartner.findUnique({
    where: { id: projectPartnerId },
    select: { id: true, projectId: true, partnerOrgId: true },
  });
  if (!existing) return { error: "Partnership not found" };
  await prisma.projectPartner.delete({ where: { id: projectPartnerId } });
  await logAuditEvent({
    action: "partner.project.unlink",
    userId: ctx.actorUserId,
    targetId: existing.id,
    metadata: {
      projectId: existing.projectId,
      partnerOrgId: existing.partnerOrgId,
    },
    request: ctx.request,
  });
  return { id: existing.id };
}
