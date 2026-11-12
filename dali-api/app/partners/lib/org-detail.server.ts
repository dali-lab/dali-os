import { redirect } from "react-router";
import { requireAuth, isNonMember } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { recordRouteVisit } from "~/lib/user-pages.server";
import { prisma } from "~/lib/db.server";
import { isCore } from "~/lib/roles";
import { resolvePhotoUrl } from "~/lib/photo";
import { loadPartnerActivityPage } from "./partner-activity-page.server";
import { listPendingInvites } from "./invites.server";
import { partnerRelationshipStatus } from "./partner-org";

export async function loadPartnerOrgDetail(request: Request, orgId: string) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  if (await isNonMember(auth, request)) return redirect("/portal");
  const canEdit = await isCore(auth.user.sub);
  if (!canEdit) return redirect("/");

  const now = new Date();

  const org = await prisma.partnerOrg.findUnique({
    where: { id: orgId },
    select: {
      id: true,
      name: true,
      logoUrl: true,
      website: true,
      isIndividual: true,
      primaryContactId: true,
      createdAt: true,
      type: true,
      address: true,
      legalEntityName: true,
      tags: true,
      notes: true,
      showcaseConsent: true,
      referredByContactId: true,
      memberships: {
        where: { endedAt: null },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          role: true,
          createdAt: true,
          contact: {
            select: {
              id: true,
              name: true,
              email: true,
              title: true,
              // Portal status for individual partners: set once they sign in.
              userId: true,
            },
          },
        },
      },
      projects: {
        orderBy: { startedAt: "desc" },
        select: {
          id: true,
          projectId: true,
          startedAt: true,
          endedAt: true,
          project: {
            select: {
              id: true,
              name: true,
              status: true,
              iconEmoji: true,
              maintenancePlans: { where: { endedAt: null }, take: 1, select: { plan: true } },
            },
          },
        },
      },
      applications: {
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          title: true,
          stage: true,
          createdAt: true,
          nextStep: true,
          nextStepDueAt: true,
          lastActivityAt: true,
          fundingType: true,
          feeCents: true,
          paymentSchedule: true,
        },
      },
      invoices: {
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          amountCents: true,
          status: true,
          issuedAt: true,
          dueAt: true,
          paidAt: true,
          reference: true,
          note: true,
        },
      },
    },
  });
  if (!org) throw new Response("Not found", { status: 404 });

  // After the gate, so a 404 never lands in someone's recents. Detached — a
  // failed bookkeeping write must not cost the reader their org page.
  recordRouteVisit(auth.user.sub, `/core/partners/orgs/${org.id}`, org.name, request);

  const [pendingInvites, linkableProjects, otherOrgs, allContacts, activityPage, lastActivityRow] =
    await Promise.all([
      listPendingInvites(org.id),
      prisma.project.findMany({
        where: {
          status: { not: "Archived" },
          partners: { none: { partnerOrgId: org.id } },
        },
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      }),
      // Targets for "move member" and the org-merge survivor picker.
      prisma.partnerOrg.findMany({
        where: { id: { not: org.id } },
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      }),
      // Candidates for "add existing contact" and "referred by".
      prisma.partnerContact.findMany({
        orderBy: { name: "asc" },
        select: { id: true, name: true, email: true },
      }),
      loadPartnerActivityPage({ orgId: org.id }),
      prisma.partnerActivity.findFirst({
        where: { orgId: org.id },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      }),
    ]);

  const status = partnerRelationshipStatus({
    projectLinks: org.projects.map((p) => ({ endedAt: p.endedAt })),
    lastActivityAt: lastActivityRow?.createdAt ?? null,
    now,
  });

  let chartStrings: {
    id: string;
    raw: string;
    normalized: string;
    type: string;
    fundingType: string | null;
    termCode: string;
    projectName: string;
  }[] = [];
  const projectIds = org.projects.map((p) => p.projectId);
  if (projectIds.length > 0) {
    const rows = await prisma.projectChartString.findMany({
      where: { projectId: { in: projectIds }, isCurrent: true },
      select: {
        id: true,
        raw: true,
        normalized: true,
        type: true,
        fundingType: true,
        projectId: true,
        term: { select: { code: true, sortKey: true } },
      },
    });
    const projectNameById = new Map(org.projects.map((p) => [p.projectId, p.project.name]));
    chartStrings = rows
      .sort((a, b) => b.term.sortKey - a.term.sortKey)
      .map((r) => ({
        id: r.id,
        raw: r.raw,
        normalized: r.normalized,
        type: r.type,
        fundingType: r.fundingType,
        termCode: r.term.code,
        projectName: projectNameById.get(r.projectId ?? "") ?? "",
      }));
  }

  return {
    org: {
      ...org,
      // Presigned display URL; `logoUrl` stays the raw stored value (an S3
      // key for partner-uploaded logos) for the edit form.
      logoDisplayUrl: await resolvePhotoUrl(org.logoUrl),
      projects: org.projects.map((p) => ({
        ...p,
        active:
          p.project.status !== "Archived" &&
          (p.startedAt === null || p.startedAt <= now) &&
          (p.endedAt === null || p.endedAt > now),
      })),
      applications: org.applications.map((a) => ({
        ...a,
        lastActivityAt: a.lastActivityAt.toISOString(),
      })),
    },
    status,
    pendingInvites,
    linkableProjects,
    otherOrgs,
    allContacts,
    activities: activityPage.items,
    activitiesNextCursor: activityPage.nextCursor,
    actorNames: activityPage.actorNames,
    chartStrings,
    canEdit,
    // Cleanup affordance for duplicate-org husks: deletable only when truly
    // empty (the action re-validates with authoritative counts). An individual
    // always carries its own self-membership, so that one doesn't block —
    // deleting the org cascades it away.
    canDeleteOrg:
      (org.isIndividual || org.memberships.length === 0) &&
      org.projects.length === 0 &&
      org.applications.length === 0 &&
      pendingInvites.length === 0,
    trailLabel: org.name,
  };
}

export type PartnerOrgData = Exclude<Awaited<ReturnType<typeof loadPartnerOrgDetail>>, Response>;
