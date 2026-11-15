import { prisma } from "~/lib/db.server";
import type { Prisma } from "~/generated/prisma/client";
import { logPartnerActivity, setApplicationStage } from "./partner-activity.server";
import { notifyPartners } from "./partner-notify.server";

type Tx = Prisma.TransactionClient;

export type ReturnableProject = { id: string; name: string; lastTermCode: string | null };

// Projects whose last planned term is before `termSortKey`: the ones that can
// come back for the planned term or later.
export async function listReturnableProjects(termSortKey: number): Promise<ReturnableProject[]> {
  const projects = await prisma.project.findMany({
    where: {
      projectTerms: { some: {} },
      NOT: { projectTerms: { some: { term: { sortKey: { gte: termSortKey } } } } },
    },
    select: {
      id: true,
      name: true,
      projectTerms: { select: { term: { select: { code: true, sortKey: true } } } },
    },
    orderBy: { name: "asc" },
  });
  return projects.map((p) => {
    const last = p.projectTerms.map((pt) => pt.term).sort((a, b) => b.sortKey - a.sortKey)[0];
    return { id: p.id, name: p.name, lastTermCode: last?.code ?? null };
  });
}

export type StartReturnResult =
  | { ok: true; applicationId: string }
  | { ok: false; error: "not-found" | "no-terms" | "no-contact" | "already-open" };

// Opens an application for a past project coming back. It carries over the
// project's partner org and its primary contact, and last term's spots as
// expected members; promotion later reopens this same project.
export async function startProjectReturn(input: {
  projectId: string;
  targetTermIds: string[];
  actorUserId: string;
}): Promise<StartReturnResult> {
  const targetTermIds = [...new Set(input.targetTermIds.filter(Boolean))];
  if (targetTermIds.length === 0) return { ok: false, error: "no-terms" };

  const project = await prisma.project.findUnique({
    where: { id: input.projectId },
    select: {
      id: true,
      name: true,
      iconEmoji: true,
      projectTerms: { select: { termId: true, term: { select: { sortKey: true } } } },
      partners: {
        orderBy: [{ endedAt: { sort: "desc", nulls: "first" } }, { startedAt: "desc" }],
        select: {
          partnerOrg: {
            select: {
              id: true,
              primaryContactId: true,
              memberships: {
                where: { endedAt: null },
                orderBy: { createdAt: "asc" },
                select: { id: true, contactId: true },
              },
            },
          },
        },
      },
    },
  });
  if (!project) return { ok: false, error: "not-found" };

  const open = await prisma.partnerApplication.findFirst({
    where: { continuesProjectId: project.id, resultingProjectId: null, stage: { not: "Rejected" } },
    select: { id: true },
  });
  if (open) return { ok: false, error: "already-open" };

  const applicant = await returnApplicant(project.id, project.partners.map((l) => l.partnerOrg));
  if (!applicant) return { ok: false, error: "no-contact" };

  const lastTerm = [...project.projectTerms].sort((a, b) => b.term.sortKey - a.term.sortKey)[0];
  const lastSpots = lastTerm
    ? await prisma.projectRoleRequest.groupBy({
        by: ["domainId"],
        where: { projectId: project.id, termId: lastTerm.termId },
        _sum: { slots: true },
      })
    : [];

  const topOfNew = await prisma.partnerApplication.aggregate({
    where: { stage: "New" },
    _min: { position: true },
  });

  const created = await prisma.partnerApplication.create({
    data: {
      title: project.name,
      iconEmoji: project.iconEmoji,
      applicantContactId: applicant.contactId,
      partnerOrgId: applicant.orgId,
      continuesProjectId: project.id,
      stage: "New",
      position: (topOfNew._min.position ?? 1) - 1,
      source: "Renewal",
      targetTerms: { create: targetTermIds.map((termId) => ({ termId })) },
      domains: {
        create: lastSpots
          .filter((s) => (s._sum.slots ?? 0) > 0)
          .map((s) => ({ domainId: s.domainId, expectedMembers: s._sum.slots ?? 0 })),
      },
    },
    select: { id: true },
  });

  await logPartnerActivity(prisma, {
    applicationId: created.id,
    actorUserId: input.actorUserId,
    type: "Created",
    metadata: { source: "Renewal", continuesProjectId: project.id },
  });
  await notifyPartners({
    eventType: "partner.inquiry_received",
    title: `Returning project: ${project.name}`,
    body: "A past project may come back. It is in New on the partner board.",
    link: `/core/partners?application=${created.id}`,
  });
  return { ok: true, applicationId: created.id };
}

// The partner to carry over: the first linked org with an active member
// (its primary contact if set), else whoever applied for the project.
async function returnApplicant(
  projectId: string,
  orgs: { id: string; primaryContactId: string | null; memberships: { id: string; contactId: string }[] }[],
): Promise<{ contactId: string; orgId: string | null } | null> {
  for (const org of orgs) {
    const member = org.memberships.find((m) => m.id === org.primaryContactId) ?? org.memberships[0];
    if (member) return { contactId: member.contactId, orgId: org.id };
  }
  const original = await prisma.partnerApplication.findFirst({
    where: { resultingProjectId: projectId },
    orderBy: { createdAt: "desc" },
    select: { applicantContactId: true, partnerOrgId: true },
  });
  return original ? { contactId: original.applicantContactId, orgId: original.partnerOrgId ?? orgs[0]?.id ?? null } : null;
}

export type ReopenInput = {
  app: {
    id: string;
    continuesProjectId: string;
    partnerOrgId: string | null;
    piUserId: string | null;
    targetTermIds: string[];
    domains: { domainId: string; expectedMembers: number }[];
  };
  actorUserId: string;
  request?: Request;
};

// Promotion for a returning project: adds the target terms back onto the
// existing project (with this application's spots where a term has none),
// marks those terms continuing, relinks the partner, and moves the
// application's planning note onto the project.
export async function reopenProjectFromApplication(
  tx: Tx,
  { app, actorUserId, request }: ReopenInput,
): Promise<{ id: string }> {
  const projectId = app.continuesProjectId;
  const spots = app.domains.filter((d) => d.expectedMembers > 0);

  for (const termId of app.targetTermIds) {
    await tx.projectTerm.upsert({
      where: { projectId_termId: { projectId, termId } },
      create: { projectId, termId, piUserId: app.piUserId },
      update: {},
    });
    const existing = await tx.projectRoleRequest.count({ where: { projectId, termId } });
    if (existing === 0 && spots.length > 0) {
      await tx.projectRoleRequest.createMany({
        data: spots.map((s) => ({ projectId, termId, domainId: s.domainId, level: "P1" as const, slots: s.expectedMembers })),
      });
    }
    await tx.projectTermStatus.upsert({
      where: { projectId_termId: { projectId, termId } },
      create: { projectId, termId, isContinuing: true, setBy: actorUserId },
      update: { isContinuing: true, setBy: actorUserId, setAt: new Date() },
    });
  }

  if (app.partnerOrgId) {
    await tx.projectPartner.upsert({
      where: { projectId_partnerOrgId: { projectId, partnerOrgId: app.partnerOrgId } },
      create: { projectId, partnerOrgId: app.partnerOrgId, startedAt: new Date() },
      update: { endedAt: null },
    });
  }

  await tx.project.update({ where: { id: projectId }, data: { status: "Active" } });

  const note = await tx.planningNote.findUnique({ where: { applicationId: app.id }, select: { id: true, body: true } });
  if (note) {
    const projectNote = await tx.planningNote.findUnique({ where: { projectId }, select: { id: true, body: true } });
    if (projectNote) {
      await tx.planningNote.update({
        where: { id: projectNote.id },
        data: { body: `${projectNote.body}\n\n${note.body}`, updatedById: actorUserId },
      });
      await tx.planningNote.delete({ where: { id: note.id } });
    } else {
      await tx.planningNote.update({ where: { id: note.id }, data: { applicationId: null, projectId } });
    }
  }

  await setApplicationStage(tx, {
    applicationId: app.id,
    to: "Accepted",
    actorUserId,
    request,
    data: { resultingProjectId: projectId },
    meta: { projectId, reopened: 1 },
  });
  return { id: projectId };
}
