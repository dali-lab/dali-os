import { useRef, useState } from "react";
import {
  Form,
  Link,
  redirect,
  useActionData,
  useLoaderData,
  useSearchParams,
  useSubmit,
} from "react-router";
import { Select, Combobox, Tooltip } from "~/components/ui/floating";
import {
  Building2,
  CircleDollarSign,
  Clock,
  ClipboardList,
  FolderKanban,
  Mail,
  Settings as SettingsIcon,
  Unlink,
  Users,
} from "lucide-react";
import { Checkbox } from "~/components/ui/Checkbox";
import { UnderlineTabButtons } from "~/components/AreaPillNav";
import { useConfirmSubmit, useDialog } from "~/components/ui/dialog";
import { ProjectIcon } from "~/components/ProjectIcon";
import type { Route } from "./+types/core.partners.orgs.$orgId";
import { requireAuth } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { recordRouteVisit } from "~/lib/user-pages.server";
import { prisma } from "~/lib/db";
import { isCore, getUserRoles } from "~/lib/roles";
import { isFeatureEnabled } from "~/lib/feature-flags.server";
import { coreHandle } from "~/core/coreNav";
import { logAuditEvent } from "~/lib/audit";
import { resolvePhotoUrl } from "~/lib/photo";
import { relativeTime } from "~/lib/relative-time";
import { formatUsd } from "~/lib/money";
import { PROJECT_FUNDING_TYPE_LABELS } from "~/lib/chart-string";
import { EditableSection } from "~/components/EditableSection";
import { PartnerActivityFeed } from "../components/PartnerActivityFeed";
import { OrgAvatar } from "../components/org/OrgAvatar";
import { OrgStatusPill, OrgTypePill } from "../components/org/OrgStatusPill";
import { InvoicesPanel } from "../components/org/InvoicesPanel";
import { upsertInvoice, setInvoiceStatus } from "../lib/partner-finance.server";
import {
  linkProjectPartner,
  unlinkProjectPartner,
  updateProjectPartnerDates,
} from "../lib/partner-access";
import {
  createPartnerInvite,
  listPendingInvites,
  revokePartnerInvite,
} from "../lib/invites.server";
import {
  classifyPartnerEmail,
  issuePartnerMagicLink,
  normalizeEmail,
} from "../lib/magic-link.server";
import {
  PARTNER_STAGE_LABELS,
  PARTNER_STAGE_PILL,
} from "../lib/partner-application";
import {
  logPartnerActivity,
} from "../lib/partner-activity.server";
import {
  PARTNER_ORG_TYPES,
  PARTNER_ORG_TYPE_LABELS,
  isPartnerOrgType,
  partnerRelationshipStatus,
  planOrgMerge,
  type PartnerRelationshipStatus,
} from "../lib/partner-org";

export const meta: Route.MetaFunction = ({ data }) => {
  const name = (data as { org?: { name: string } } | undefined)?.org?.name;
  return [{ title: name ? `${name} · DALI OS` : "Organization · DALI OS" }];
};

// The trailing crumb reads the org name off `trailLabel`, set below, so the
// trail is "Core › Partner CRM › <org name>".
export const handle = {
  ...coreHandle("partners", (data) => (data as { trailLabel?: string } | null)?.trailLabel),
  favoriteRoute: true,
};

export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  if (auth.user.type === "applicant") return redirect("/portal");
  const canEdit = await isCore(auth.user.sub);
  if (!canEdit) return redirect("/");

  const now = new Date();
  const roles = await getUserRoles(auth.user.sub, request);
  const financeEnabled = await isFeatureEnabled("partner-finance", auth.user.sub, roles, request);

  const org = await prisma.partnerOrg.findUnique({
    where: { id: params.orgId },
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
          project: { select: { id: true, name: true, status: true, iconEmoji: true } },
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

  const [pendingInvites, linkableProjects, otherOrgs, allContacts, activityRows, lastActivityRow] =
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
      prisma.partnerActivity.findMany({
        where: { orgId: org.id },
        orderBy: { createdAt: "desc" },
        take: 50,
        select: {
          id: true,
          createdAt: true,
          applicationId: true,
          actorUserId: true,
          type: true,
          body: true,
          metadata: true,
        },
      }),
      prisma.partnerActivity.findFirst({
        where: { orgId: org.id },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      }),
    ]);

  const activities = activityRows.map((r) => ({
    id: r.id,
    createdAt: r.createdAt.toISOString(),
    applicationId: r.applicationId,
    actorUserId: r.actorUserId,
    type: r.type,
    body: r.body,
    metadata: (r.metadata ?? null) as Record<string, unknown> | null,
  }));
  const actorIds = [
    ...new Set(activityRows.map((r) => r.actorUserId).filter(Boolean)),
  ] as string[];
  let actorNames: Record<string, string> = {};
  if (actorIds.length > 0) {
    const users = await prisma.user.findMany({
      where: { id: { in: actorIds } },
      select: { id: true, firstName: true, lastName: true, daliEmail: true },
    });
    actorNames = Object.fromEntries(
      users.map((u) => [
        u.id,
        [u.firstName, u.lastName].filter(Boolean).join(" ") || u.daliEmail || u.id,
      ]),
    );
  }

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
  if (financeEnabled) {
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
    activities,
    actorNames,
    financeEnabled,
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

export async function action({ request, params }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  if (!(await isCore(auth.user.sub))) {
    return { error: "You don't have permission to edit organizations." };
  }
  const org = await prisma.partnerOrg.findUnique({
    where: { id: params.orgId },
    select: { id: true, name: true, primaryContactId: true, isIndividual: true },
  });
  if (!org) throw new Response("Not found", { status: 404 });

  const form = await request.formData();
  const intent = form.get("intent") as string;
  const actor = { actorUserId: auth.user.sub, request };

  if (intent === "org-details") {
    const name = (form.get("name") as string | null)?.trim() ?? "";
    if (!name) return { error: "A name is required." };
    const isIndividual = form.get("isIndividual") === "on";

    // CRM fields (spec §7 Settings): shared by both the individual and the
    // organization branch below.
    const typeRaw = (form.get("type") as string | null) ?? "";
    const type = isPartnerOrgType(typeRaw) ? typeRaw : null;
    const address = (form.get("address") as string | null)?.trim() || null;
    const legalEntityName = (form.get("legalEntityName") as string | null)?.trim() || null;
    const tags = ((form.get("tags") as string | null) ?? "")
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    const notes = (form.get("notes") as string | null)?.trim() || null;
    const showcaseConsent = form.get("showcaseConsent") === "on";
    const referredByContactId = (form.get("referredByContactId") as string | null) || null;
    if (referredByContactId) {
      const referrer = await prisma.partnerContact.findUnique({
        where: { id: referredByContactId },
        select: { id: true },
      });
      if (!referrer) return { error: "Referred-by contact not found." };
    }
    const crmFields = { type, address, legalEntityName, tags, notes, showcaseConsent, referredByContactId };

    if (isIndividual) {
      // An individual's name + email live on their sole contact. The org keeps
      // no website/logo, and its primary contact stays that person. Legacy
      // individuals created before this fix have no membership yet, so we set
      // one up here (the lazy heal).
      const email = normalizeEmail((form.get("email") as string | null) ?? "");
      if (!email.includes("@")) {
        return { error: "An email is required for an individual partner." };
      }
      const identity = await classifyPartnerEmail(email);
      if (identity.kind === "member-conflict") {
        return {
          error:
            "That address belongs to a DALI member or Dartmouth account. Partners use a separate work email.",
        };
      }
      const membership = await prisma.partnerMembership.findFirst({
        where: { orgId: org.id, endedAt: null },
        orderBy: { createdAt: "asc" },
        select: { id: true, contactId: true },
      });
      try {
        await prisma.$transaction(async (tx) => {
          if (membership) {
            await tx.partnerContact.update({
              where: { id: membership.contactId },
              data: { name, email },
            });
            await tx.partnerOrg.update({
              where: { id: org.id },
              data: {
                name,
                isIndividual: true,
                website: null,
                logoUrl: null,
                primaryContactId: org.primaryContactId ?? membership.id,
                ...crmFields,
              },
            });
          } else {
            const contact = await tx.partnerContact.upsert({
              where: { email },
              create: { email, name },
              update: { name },
              select: { id: true },
            });
            const created = await tx.partnerMembership.create({
              data: { contactId: contact.id, orgId: org.id },
              select: { id: true },
            });
            await tx.partnerOrg.update({
              where: { id: org.id },
              data: {
                name,
                isIndividual: true,
                website: null,
                logoUrl: null,
                primaryContactId: created.id,
                ...crmFields,
              },
            });
          }
        });
      } catch (e) {
        // PartnerContact.email is unique — collision means another contact
        // already owns this address.
        if ((e as { code?: string })?.code === "P2002") {
          return { error: "Another partner already uses that email address." };
        }
        throw e;
      }
      await logAuditEvent({
        action: "partner.org.update",
        userId: auth.user.sub,
        targetId: org.id,
        request,
      });
      await logPartnerActivity(prisma, {
        orgId: org.id,
        actorUserId: auth.user.sub,
        type: "OrgUpdated",
      });
      return { ok: true };
    }

    const primaryContactId =
      (form.get("primaryContactId") as string | null) || null;
    if (primaryContactId) {
      const contact = await prisma.partnerMembership.findFirst({
        where: { id: primaryContactId, orgId: org.id, endedAt: null },
        select: { id: true },
      });
      if (!contact) return { error: "Primary contact must belong to this organization." };
    }
    await prisma.partnerOrg.update({
      where: { id: org.id },
      data: {
        name,
        website: (form.get("website") as string | null)?.trim() || null,
        logoUrl: (form.get("logoUrl") as string | null)?.trim() || null,
        isIndividual: false,
        primaryContactId,
        ...crmFields,
      },
    });
    await logAuditEvent({
      action: "partner.org.update",
      userId: auth.user.sub,
      targetId: org.id,
      request,
    });
    await logPartnerActivity(prisma, {
      orgId: org.id,
      actorUserId: auth.user.sub,
      type: "OrgUpdated",
    });
    return { ok: true };
  }

  if (intent === "send-signin-link") {
    // Individual partners already have their contact + membership; portal
    // access is a self-service magic link, not the teammate-invite flow
    // (that path would create a second membership and hit the unique index).
    const membership = await prisma.partnerMembership.findFirst({
      where: { orgId: org.id, endedAt: null },
      orderBy: { createdAt: "asc" },
      select: { contact: { select: { email: true } } },
    });
    const email = membership?.contact.email;
    if (!email) return { error: "This partner has no contact email yet." };
    const result = await issuePartnerMagicLink(email, request);
    if ("rateLimited" in result) {
      return {
        error: "Too many sign-in links were just sent. Try again in a few minutes.",
      };
    }
    return { ok: true };
  }

  if (intent === "member-role") {
    const membershipId = form.get("partnerUserId") as string;
    const role = (form.get("displayRole") as string | null)?.trim() || null;
    const res = await prisma.partnerMembership.updateMany({
      where: { id: membershipId, orgId: org.id, endedAt: null },
      data: { role },
    });
    if (res.count !== 1) return { error: "Member not found." };
    await logAuditEvent({
      action: "partner.member.update",
      userId: auth.user.sub,
      targetId: membershipId,
      metadata: { orgId: org.id },
      request,
    });
    return { ok: true };
  }

  if (intent === "member-set-primary") {
    const membershipId = form.get("membershipId") as string;
    const member = await prisma.partnerMembership.findFirst({
      where: { id: membershipId, orgId: org.id, endedAt: null },
      select: { id: true },
    });
    if (!member) return { error: "Member not found." };
    await prisma.partnerOrg.update({
      where: { id: org.id },
      data: { primaryContactId: membershipId },
    });
    await logAuditEvent({
      action: "partner.org.update",
      userId: auth.user.sub,
      targetId: org.id,
      metadata: { primaryContactId: membershipId },
      request,
    });
    return { ok: true };
  }

  if (intent === "member-add") {
    const contactId = form.get("contactId") as string;
    if (!contactId) return { error: "Choose a contact to add." };
    const contact = await prisma.partnerContact.findUnique({
      where: { id: contactId },
      select: { id: true },
    });
    if (!contact) return { error: "Contact not found." };
    // Upsert on the (contactId, orgId) unique pair rather than a plain
    // create: a contact who was previously removed from this org still has
    // a (soft-ended) row that a plain create would collide with.
    await prisma.partnerMembership.upsert({
      where: { contactId_orgId: { contactId, orgId: org.id } },
      create: { contactId, orgId: org.id },
      update: { endedAt: null },
    });
    await logPartnerActivity(prisma, {
      orgId: org.id,
      actorUserId: auth.user.sub,
      type: "MemberAdded",
      metadata: { contactId },
    });
    await logAuditEvent({
      action: "partner.member.update",
      userId: auth.user.sub,
      targetId: org.id,
      metadata: { addedContactId: contactId },
      request,
    });
    return { ok: true };
  }

  if (intent === "member-move") {
    // "partnerUserId" hidden field name preserved for UI compatibility.
    const membershipId = form.get("partnerUserId") as string;
    const targetOrgId = (form.get("targetOrgId") as string | null) ?? "";
    if (!targetOrgId) return { error: "Choose an organization to move them to." };
    if (targetOrgId === org.id) {
      return { error: "They're already in this organization." };
    }
    const [member, target] = await Promise.all([
      prisma.partnerMembership.findFirst({
        where: { id: membershipId, orgId: org.id, endedAt: null },
        select: { id: true, contactId: true },
      }),
      prisma.partnerOrg.findUnique({
        where: { id: targetOrgId },
        select: { id: true },
      }),
    ]);
    if (!member) return { error: "Member not found." };
    if (!target) return { error: "That organization no longer exists." };
    await prisma.$transaction(async (tx) => {
      // Primary contact doesn't travel — the source org just loses it.
      if (org.primaryContactId === membershipId) {
        await tx.partnerOrg.update({
          where: { id: org.id },
          data: { primaryContactId: null },
        });
      }
      // End the current membership and open a new one in the target org.
      await tx.partnerMembership.update({
        where: { id: membershipId },
        data: { endedAt: new Date() },
      });
      await tx.partnerMembership.create({
        data: { contactId: member.contactId, orgId: targetOrgId },
      });
    });
    await logAuditEvent({
      action: "partner.member.update",
      userId: auth.user.sub,
      targetId: membershipId,
      metadata: { movedFrom: org.id, movedTo: targetOrgId },
      request,
    });
    return { ok: true };
  }

  if (intent === "org-delete") {
    // Only a truly empty org may go: members, project links, applications,
    // and pending invites all block. Historical (accepted/revoked/expired)
    // invite rows don't — they're deleted with the org.
    const [memberCount, projectCount, applicationCount, pendingInviteCount] =
      await Promise.all([
        prisma.partnerMembership.count({ where: { orgId: org.id, endedAt: null } }),
        prisma.projectPartner.count({ where: { partnerOrgId: org.id } }),
        prisma.partnerApplication.count({ where: { partnerOrgId: org.id } }),
        prisma.partnerInvite.count({
          where: {
            partnerOrgId: org.id,
            acceptedAt: null,
            revokedAt: null,
            expiresAt: { gt: new Date() },
          },
        }),
      ]);
    // An individual's own self-membership doesn't block — deleting the org
    // cascades it. Projects, applications, and pending invites still do.
    if (
      (!org.isIndividual && memberCount) ||
      projectCount ||
      applicationCount ||
      pendingInviteCount
    ) {
      return {
        error:
          "Only an empty organization can be deleted. This one still has members, projects, applications, or a pending invite.",
      };
    }
    await prisma.$transaction(async (tx) => {
      await tx.partnerInvite.deleteMany({ where: { partnerOrgId: org.id } });
      await tx.partnerOrg.delete({ where: { id: org.id } });
    });
    await logAuditEvent({
      action: "partner.org.delete",
      userId: auth.user.sub,
      targetId: org.id,
      request,
    });
    // Preserve ?embed=1 — dropping it would swap the standalone page for the
    // full workspace shell (or nest a shell inside the workspace iframe).
    const embed = new URL(request.url).searchParams.has("embed");
    return redirect(embed ? "/core/partners/directory?embed=1" : "/core/partners/directory");
  }

  if (intent === "member-remove") {
    // "partnerUserId" hidden field name preserved for UI compatibility.
    const membershipId = form.get("partnerUserId") as string;
    const member = await prisma.partnerMembership.findFirst({
      where: { id: membershipId, orgId: org.id, endedAt: null },
      select: { id: true },
    });
    if (!member) return { error: "Member not found." };
    await prisma.$transaction(async (tx) => {
      if (org.primaryContactId === membershipId) {
        await tx.partnerOrg.update({
          where: { id: org.id },
          data: { primaryContactId: null },
        });
      }
      // End the membership — preserves history rather than hard-deleting.
      await tx.partnerMembership.update({
        where: { id: membershipId },
        data: { endedAt: new Date() },
      });
    });
    await logPartnerActivity(prisma, {
      orgId: org.id,
      actorUserId: auth.user.sub,
      type: "MemberRemoved",
      metadata: { membershipId },
    });
    await logAuditEvent({
      action: "partner.member.remove",
      userId: auth.user.sub,
      targetId: membershipId,
      metadata: { orgId: org.id },
      request,
    });
    return { ok: true };
  }

  if (intent === "project-link") {
    const projectId = form.get("projectId") as string;
    if (!projectId) return { error: "Select a project." };
    const result = await linkProjectPartner(
      { projectId, partnerOrgId: org.id },
      actor,
    );
    if ("error" in result) return result;
    await logPartnerActivity(prisma, {
      orgId: org.id,
      actorUserId: auth.user.sub,
      type: "ProjectLinked",
      metadata: { projectId },
    });
    return { ok: true };
  }

  if (intent === "project-end") {
    const projectPartnerId = form.get("projectPartnerId") as string;
    const existing = await prisma.projectPartner.findFirst({
      where: { id: projectPartnerId, partnerOrgId: org.id },
      select: { startedAt: true, projectId: true },
    });
    if (!existing) return { error: "Partnership not found." };
    const result = await updateProjectPartnerDates(
      { projectPartnerId, startedAt: existing.startedAt, endedAt: new Date() },
      actor,
    );
    if ("error" in result) return result;
    await logPartnerActivity(prisma, {
      orgId: org.id,
      actorUserId: auth.user.sub,
      type: "ProjectEnded",
      metadata: { projectId: existing.projectId },
    });
    return { ok: true };
  }

  if (intent === "project-unlink") {
    const projectPartnerId = form.get("projectPartnerId") as string;
    const existing = await prisma.projectPartner.findFirst({
      where: { id: projectPartnerId, partnerOrgId: org.id },
      select: { id: true },
    });
    if (!existing) return { error: "Partnership not found." };
    const result = await unlinkProjectPartner(projectPartnerId, actor);
    return "error" in result ? result : { ok: true };
  }

  if (intent === "invite") {
    const email = (form.get("email") as string | null) ?? "";
    const displayRole =
      (form.get("displayRole") as string | null)?.trim() || null;
    const result = await createPartnerInvite(
      {
        partnerOrgId: org.id,
        email,
        displayRole,
        invitedByUserId: auth.user.sub,
      },
      request,
    );
    return "error" in result ? result : { ok: true, invited: true };
  }

  if (intent === "revoke-invite") {
    const inviteId = form.get("inviteId") as string;
    const result = await revokePartnerInvite(
      { inviteId, partnerOrgId: org.id, actorUserId: auth.user.sub },
      request,
    );
    return "error" in result ? result : { ok: true };
  }

  if (intent === "note") {
    // PartnerActivityFeed's built-in composer always posts intent "note" (it
    // isn't parameterized) — this route's action only ever sees its own org's
    // feed, so there's no ambiguity to disambiguate with a more specific name.
    const body = (form.get("body") as string | null)?.trim() ?? "";
    if (!body) return { error: "Note can't be empty." };
    await logPartnerActivity(prisma, {
      orgId: org.id,
      actorUserId: auth.user.sub,
      type: "Note",
      body,
    });
    return { ok: true };
  }

  if (intent === "org-merge") {
    const survivorId = (form.get("survivorOrgId") as string | null) ?? "";
    if (!survivorId) return { error: "Choose an organization to merge into." };
    if (survivorId === org.id) {
      return { error: "Choose a different organization to merge into." };
    }
    const survivor = await prisma.partnerOrg.findUnique({
      where: { id: survivorId },
      select: { id: true },
    });
    if (!survivor) return { error: "That organization no longer exists." };

    const [sourceMemberships, survivorMemberships, sourceProjectLinks, survivorProjectLinks] =
      await Promise.all([
        prisma.partnerMembership.findMany({
          where: { orgId: org.id, endedAt: null },
          select: { id: true, contactId: true },
        }),
        prisma.partnerMembership.findMany({
          where: { orgId: survivorId, endedAt: null },
          select: { contactId: true },
        }),
        prisma.projectPartner.findMany({
          where: { partnerOrgId: org.id },
          select: { id: true, projectId: true },
        }),
        prisma.projectPartner.findMany({
          where: { partnerOrgId: survivorId },
          select: { projectId: true },
        }),
      ]);

    const plan = planOrgMerge({
      sourceMemberships,
      survivorContactIds: survivorMemberships.map((m) => m.contactId),
      sourceProjectLinks,
      survivorProjectIds: survivorProjectLinks.map((p) => p.projectId),
    });

    await prisma.$transaction(async (tx) => {
      if (plan.membershipIdsToRepoint.length > 0) {
        await tx.partnerMembership.updateMany({
          where: { id: { in: plan.membershipIdsToRepoint } },
          data: { orgId: survivorId },
        });
      }
      if (plan.projectLinkIdsToRepoint.length > 0) {
        await tx.projectPartner.updateMany({
          where: { id: { in: plan.projectLinkIdsToRepoint } },
          data: { partnerOrgId: survivorId },
        });
      }
      if (plan.projectLinkIdsToRemove.length > 0) {
        // Duplicate links at the survivor — ProjectPartner has no cascade, so
        // these have to go before the source org can be deleted.
        await tx.projectPartner.deleteMany({
          where: { id: { in: plan.projectLinkIdsToRemove } },
        });
      }
      await tx.partnerApplication.updateMany({
        where: { partnerOrgId: org.id },
        data: { partnerOrgId: survivorId },
      });
      // Activities and invoices cascade-delete with the org by default —
      // repoint them first so the history and the receivables survive the
      // merge instead of vanishing with the source row.
      await tx.partnerActivity.updateMany({
        where: { orgId: org.id },
        data: { orgId: survivorId },
      });
      await tx.partnerInvite.updateMany({
        where: { partnerOrgId: org.id },
        data: { partnerOrgId: survivorId },
      });
      await tx.partnerInvoice.updateMany({
        where: { orgId: org.id },
        data: { orgId: survivorId },
      });
      await tx.partnerOrg.delete({ where: { id: org.id } });
      await logPartnerActivity(tx, {
        orgId: survivorId,
        actorUserId: auth.user.sub,
        type: "OrgUpdated",
        metadata: { mergedFromOrgId: org.id, mergedFromName: org.name },
      });
    });
    await logAuditEvent({
      action: "partner.org.update",
      userId: auth.user.sub,
      targetId: survivorId,
      metadata: { merged: true, mergedFromOrgId: org.id },
      request,
    });

    const embed = new URL(request.url).searchParams.has("embed");
    return redirect(`/core/partners/orgs/${survivorId}${embed ? "?embed=1" : ""}`);
  }

  if (intent === "invoice-save") {
    const amountRaw = (form.get("amount") as string | null)?.trim() ?? "";
    const amountCents = amountRaw ? Math.round(Number(amountRaw) * 100) : NaN;
    if (!amountRaw || isNaN(amountCents) || amountCents < 0) {
      return { error: "Enter a valid invoice amount." };
    }
    const issuedAtRaw = (form.get("issuedAt") as string | null)?.trim() ?? "";
    const dueAtRaw = (form.get("dueAt") as string | null)?.trim() ?? "";
    await upsertInvoice({
      orgId: org.id,
      amountCents,
      reference: (form.get("reference") as string | null)?.trim() || null,
      note: (form.get("note") as string | null)?.trim() || null,
      issuedAt: issuedAtRaw ? new Date(issuedAtRaw) : null,
      dueAt: dueAtRaw ? new Date(dueAtRaw) : null,
    });
    return { ok: true };
  }

  if (intent === "invoice-status") {
    const invoiceId = (form.get("invoiceId") as string | null) ?? "";
    const status = form.get("status");
    const validStatuses = ["Draft", "Issued", "Paid", "Void"];
    if (!invoiceId || typeof status !== "string" || !validStatuses.includes(status)) {
      return { error: "Invalid invoice status update." };
    }
    const result = await setInvoiceStatus({
      invoiceId,
      status: status as "Draft" | "Issued" | "Paid" | "Void",
      actorUserId: auth.user.sub,
    });
    if ("error" in result) return { error: result.error };
    return { ok: true };
  }

  return { error: "Unknown action." };
}

function memberName(c: { name: string; email: string | null }) {
  return c.name || c.email || "Unnamed";
}

const detailInputClass =
  "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm";

// loader returns redirect() (a Response) on auth-fail branches; the component
// only renders on the data branch, so narrow it out.
type LoaderData = Exclude<Awaited<ReturnType<typeof loader>>, Response>;
type LoaderOrg = LoaderData["org"];

const ORG_TAB_VALUES = [
  "timeline",
  "contacts",
  "applications",
  "projects",
  "finance",
  "settings",
] as const;
type OrgTab = (typeof ORG_TAB_VALUES)[number];
function isOrgTab(x: string | null): x is OrgTab {
  return !!x && (ORG_TAB_VALUES as readonly string[]).includes(x);
}

// The Details body. Individuals show Name + Email (both stored on the sole
// contact) and hide the org-only Website/Logo/Primary-contact fields. The
// Individual checkbox is controlled so toggling it swaps the fields live;
// EditableSection remounts this on Cancel, resetting the state.
function DetailsFields({
  org,
  editing,
  allContacts,
}: {
  org: LoaderOrg;
  editing: boolean;
  allContacts: { id: string; name: string; email: string | null }[];
}) {
  const [individual, setIndividual] = useState(org.isIndividual);
  const [showcaseConsent, setShowcaseConsent] = useState(org.showcaseConsent);
  const [referredByContactId, setReferredByContactId] = useState(
    org.referredByContactId ?? "",
  );
  const soleContact = org.memberships[0]?.contact ?? null;

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <input type="hidden" name="intent" value="org-details" />
      <input type="hidden" name="showcaseConsent" value={showcaseConsent ? "on" : ""} />
      <input type="hidden" name="referredByContactId" value={referredByContactId} />
      <div>
        <div className="text-xs font-medium text-muted-foreground mb-1">Name</div>
        {editing ? (
          <input name="name" defaultValue={org.name} required className={detailInputClass} />
        ) : (
          <div className="text-sm text-foreground">{org.name}</div>
        )}
      </div>

      {individual ? (
        <div>
          <div className="text-xs font-medium text-muted-foreground mb-1">Email</div>
          {editing ? (
            <input
              name="email"
              type="email"
              required
              defaultValue={soleContact?.email ?? ""}
              className={detailInputClass}
            />
          ) : (
            <div className="text-sm text-foreground">{soleContact?.email ?? "—"}</div>
          )}
        </div>
      ) : (
        <>
          <div>
            <div className="text-xs font-medium text-muted-foreground mb-1">Website</div>
            {editing ? (
              <input name="website" defaultValue={org.website ?? ""} className={detailInputClass} />
            ) : (
              <div className="text-sm text-foreground">{org.website ?? "—"}</div>
            )}
          </div>
          <div>
            <div className="text-xs font-medium text-muted-foreground mb-1">Logo URL</div>
            {editing ? (
              <input name="logoUrl" defaultValue={org.logoUrl ?? ""} className={detailInputClass} />
            ) : (
              <div className="text-sm text-foreground truncate">{org.logoUrl ?? "—"}</div>
            )}
          </div>
          <div>
            <div className="text-xs font-medium text-muted-foreground mb-1">Primary contact</div>
            {editing ? (
              <Select
                name="primaryContactId"
                defaultValue={org.primaryContactId ?? ""}
                options={[
                  { value: "", label: "None" },
                  ...org.memberships.map((m) => ({ value: m.id, label: memberName(m.contact) })),
                ]}
                buttonClassName={`${detailInputClass} inline-flex items-center justify-between gap-1 transition-colors hover:bg-muted/40`}
              />
            ) : (
              <div className="text-sm text-foreground">
                {memberName(
                  org.memberships.find((m) => m.id === org.primaryContactId)?.contact ?? {
                    name: "—",
                    email: null,
                  },
                )}
              </div>
            )}
          </div>
        </>
      )}

      <div>
        <div className="text-xs font-medium text-muted-foreground mb-1">Type</div>
        {editing ? (
          <Select
            name="type"
            defaultValue={org.type ?? ""}
            options={[
              { value: "", label: "Not set" },
              ...PARTNER_ORG_TYPES.map((t) => ({ value: t, label: PARTNER_ORG_TYPE_LABELS[t] })),
            ]}
            buttonClassName={`${detailInputClass} inline-flex items-center justify-between gap-1 transition-colors hover:bg-muted/40`}
          />
        ) : (
          <div className="text-sm text-foreground">
            {org.type ? PARTNER_ORG_TYPE_LABELS[org.type] : "—"}
          </div>
        )}
      </div>
      <div>
        <div className="text-xs font-medium text-muted-foreground mb-1">Legal entity name</div>
        {editing ? (
          <input name="legalEntityName" defaultValue={org.legalEntityName ?? ""} className={detailInputClass} />
        ) : (
          <div className="text-sm text-foreground">{org.legalEntityName ?? "—"}</div>
        )}
      </div>
      <div className="sm:col-span-2">
        <div className="text-xs font-medium text-muted-foreground mb-1">Address</div>
        {editing ? (
          <input name="address" defaultValue={org.address ?? ""} className={detailInputClass} />
        ) : (
          <div className="text-sm text-foreground">{org.address ?? "—"}</div>
        )}
      </div>
      <div className="sm:col-span-2">
        <div className="text-xs font-medium text-muted-foreground mb-1">Tags</div>
        {editing ? (
          <input
            name="tags"
            defaultValue={org.tags.join(", ")}
            placeholder="comma-separated"
            className={detailInputClass}
          />
        ) : org.tags.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {org.tags.map((t) => (
              <span key={t} className="text-xs rounded-full bg-muted text-muted-foreground px-2 py-0.5">
                {t}
              </span>
            ))}
          </div>
        ) : (
          <div className="text-sm text-foreground">—</div>
        )}
      </div>
      <div className="sm:col-span-2">
        <div className="text-xs font-medium text-muted-foreground mb-1">Notes</div>
        {editing ? (
          <textarea
            name="notes"
            defaultValue={org.notes ?? ""}
            rows={3}
            className={detailInputClass}
          />
        ) : (
          <div className="text-sm text-foreground whitespace-pre-wrap">{org.notes ?? "—"}</div>
        )}
      </div>
      <div>
        <div className="text-xs font-medium text-muted-foreground mb-1">Referred by</div>
        {editing ? (
          <Combobox
            value={referredByContactId}
            onChange={setReferredByContactId}
            ariaLabel="Referred by"
            placeholder="None"
            options={[
              { value: "", label: "None" },
              ...allContacts.map((c) => ({ value: c.id, label: c.name || c.email || c.id })),
            ]}
            className={`${detailInputClass} flex`}
          />
        ) : (
          <div className="text-sm text-foreground">
            {allContacts.find((c) => c.id === org.referredByContactId)?.name ?? "—"}
          </div>
        )}
      </div>

      {editing ? (
        <Checkbox
          name="isIndividual"
          checked={individual}
          onChange={(e) => setIndividual(e.target.checked)}
          label="Individual (not an organization)"
          className="text-sm text-foreground"
        />
      ) : (
        <Checkbox
          checked={org.isIndividual}
          disabled
          label="Individual (not an organization)"
          className="text-sm text-foreground"
        />
      )}
      {editing ? (
        <Checkbox
          checked={showcaseConsent}
          onChange={(e) => setShowcaseConsent(e.target.checked)}
          label="Showcase consent"
          description="The partner agreed to be named on the public showcase."
          className="text-sm text-foreground"
        />
      ) : (
        <Checkbox
          checked={org.showcaseConsent}
          disabled
          label="Showcase consent"
          className="text-sm text-foreground"
        />
      )}
    </div>
  );
}

function MergeOrgCard({
  org,
  otherOrgs,
}: {
  org: { id: string; name: string };
  otherOrgs: { id: string; name: string }[];
}) {
  const [target, setTarget] = useState("");
  const dialog = useDialog();
  const submit = useSubmit();
  const formRef = useRef<HTMLFormElement>(null);
  if (otherOrgs.length === 0) return null;
  const targetName = otherOrgs.find((o) => o.id === target)?.name ?? "";

  return (
    <section className="bg-card border border-border rounded-lg p-4 flex flex-col gap-3">
      <h2 className="text-sm font-semibold text-foreground">Merge into another organization</h2>
      <p className="text-xs text-muted-foreground">
        Members, applications, project links, activity, invites, and invoices move to the
        organization you pick. This organization is deleted. It can't be undone.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <Combobox
          value={target}
          onChange={setTarget}
          ariaLabel="Merge into"
          placeholder="Choose an organization…"
          options={otherOrgs.map((o) => ({ value: o.id, label: o.name }))}
          className="flex-1 min-w-[220px] px-3 py-2 text-sm border border-border rounded-lg bg-background text-foreground"
        />
        <Form method="post" ref={formRef}>
          <input type="hidden" name="intent" value="org-merge" />
          <input type="hidden" name="survivorOrgId" value={target} />
          <button
            type="button"
            disabled={!target}
            onClick={async () => {
              if (
                await dialog.confirm({
                  title: `Merge ${org.name} into ${targetName}?`,
                  description:
                    "This organization is deleted once everything moves over. This can't be undone.",
                  confirmLabel: "Merge",
                  tone: "destructive",
                })
              ) {
                submit(formRef.current);
              }
            }}
            className="px-3 py-1.5 text-sm font-medium rounded-md border border-border hover:bg-muted transition disabled:opacity-50"
          >
            Merge
          </button>
        </Form>
      </div>
    </section>
  );
}

export default function PartnerOrgDetail() {
  const {
    org,
    status,
    pendingInvites,
    linkableProjects,
    otherOrgs,
    allContacts,
    activities,
    actorNames,
    financeEnabled,
    chartStrings,
    canDeleteOrg,
    canEdit,
  } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const confirmSubmit = useConfirmSubmit();
  const detailsFormRef = useRef<HTMLFormElement>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const [inviting, setInviting] = useState(false);
  const [linking, setLinking] = useState(false);
  const [addingContact, setAddingContact] = useState(false);
  const [addContactId, setAddContactId] = useState("");
  // Which member row has the "move to another org" form open.
  const [movingId, setMovingId] = useState<string | null>(null);
  // Which project row has its End/Unlink actions revealed.
  const [managingId, setManagingId] = useState<string | null>(null);

  const error = actionData && "error" in actionData ? actionData.error : null;

  const inputClass =
    "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm";

  // An individual partner is a single person — their sole membership's contact.
  const soleContact = org.isIndividual ? org.memberships[0]?.contact ?? null : null;

  const tabParam = searchParams.get("tab");
  const tab: OrgTab =
    isOrgTab(tabParam) && (tabParam !== "finance" || financeEnabled) ? tabParam : "timeline";
  const setTab = (next: OrgTab) =>
    setSearchParams(
      (prev) => {
        prev.set("tab", next);
        return prev;
      },
      { replace: true, preventScrollReset: true },
    );

  const memberContactIds = new Set(org.memberships.map((m) => m.contact.id));
  const addContactCandidates = allContacts.filter((c) => !memberContactIds.has(c.id));

  const tabItems = [
    { label: "Timeline", value: "timeline" as const, icon: Clock },
    { label: "Contacts", value: "contacts" as const, icon: Users },
    { label: "Applications", value: "applications" as const, icon: ClipboardList },
    { label: "Projects", value: "projects" as const, icon: FolderKanban },
    ...(financeEnabled
      ? [{ label: "Finance", value: "finance" as const, icon: CircleDollarSign }]
      : []),
    { label: "Settings", value: "settings" as const, icon: SettingsIcon },
  ];

  return (
    <div className="flex flex-col gap-6 max-w-4xl">
      <div className="flex items-center gap-4">
        <OrgAvatar org={org} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="font-heading text-2xl font-bold text-foreground truncate">
              {org.name}
            </h1>
            <OrgTypePill type={org.type} />
            <OrgStatusPill status={status as PartnerRelationshipStatus} />
          </div>
          <p className="text-sm text-muted-foreground">
            {org.isIndividual ? "Individual partner" : "Partner organization"}
            {org.website && (
              <>
                {" · "}
                <a
                  href={org.website}
                  target="_blank"
                  rel="noreferrer"
                  className="underline hover:text-foreground"
                >
                  {org.website.replace(/^https?:\/\//, "")}
                </a>
              </>
            )}
          </p>
          {org.tags.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {org.tags.map((t) => (
                <span
                  key={t}
                  className="text-xs rounded-full bg-muted text-muted-foreground px-2 py-0.5"
                >
                  {t}
                </span>
              ))}
            </div>
          )}
        </div>
        {canEdit && (
          <button
            type="button"
            onClick={() => setTab("settings")}
            className="px-3 py-1.5 text-sm font-medium rounded-md border border-border hover:bg-muted transition"
          >
            Edit
          </button>
        )}
      </div>

      {error && (
        <p className="text-sm text-destructive bg-destructive/10 rounded-lg px-4 py-3">
          {error}
        </p>
      )}

      <UnderlineTabButtons
        label="Organization"
        items={tabItems.map((t) => ({
          label: t.label,
          icon: t.icon,
          active: tab === t.value,
          onClick: () => setTab(t.value),
        }))}
      />

      {tab === "timeline" && (
        <PartnerActivityFeed activities={activities} actorNames={actorNames} canEdit={canEdit} />
      )}

      {tab === "contacts" && (
        <section className="bg-card border border-border rounded-lg p-4 flex flex-col gap-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h2 className="font-heading font-semibold text-foreground flex items-center gap-2">
              <Users className="w-4 h-4" /> {org.isIndividual ? "Contact" : "Members"}
            </h2>
            {!org.isIndividual && canEdit && (
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setAddingContact((v) => !v)}
                  className="text-sm text-dark-blue hover:underline"
                >
                  + Add existing contact
                </button>
                <button
                  type="button"
                  onClick={() => setInviting((v) => !v)}
                  className="text-sm text-dark-blue hover:underline"
                >
                  + Invite member
                </button>
              </div>
            )}
          </div>

          {addingContact && canEdit && !org.isIndividual && (
            <Form
              method="post"
              onSubmit={() => {
                setAddingContact(false);
                setAddContactId("");
              }}
              className="flex flex-wrap items-end gap-3 bg-muted/20 rounded-lg p-3"
            >
              <input type="hidden" name="intent" value="member-add" />
              <input type="hidden" name="contactId" value={addContactId} />
              <div className="flex-1 min-w-[240px]">
                <label className="block text-xs font-medium text-muted-foreground mb-1">
                  Contact
                </label>
                <Combobox
                  value={addContactId}
                  onChange={setAddContactId}
                  ariaLabel="Add existing contact"
                  placeholder="Search contacts…"
                  options={addContactCandidates.map((c) => ({
                    value: c.id,
                    label: c.name || c.email || c.id,
                    description: c.email ?? undefined,
                  }))}
                  className={`${inputClass} flex`}
                />
              </div>
              <button
                type="submit"
                disabled={!addContactId}
                className="rounded-lg bg-dark-blue text-white text-sm font-medium px-4 py-2 hover:opacity-90 transition disabled:opacity-50"
              >
                Add
              </button>
            </Form>
          )}

          {org.isIndividual ? (
            soleContact ? (
              <div className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-foreground">
                    {memberName(soleContact)}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {soleContact.email ?? "no email"}
                  </div>
                </div>
                <span
                  className={`text-xs rounded-full px-2 py-0.5 ${
                    soleContact.userId
                      ? "bg-accent-teal/15 text-accent-teal"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  {soleContact.userId ? "Active" : "Hasn't signed in"}
                </span>
                {canEdit && (
                  <Form
                    method="post"
                    onSubmit={confirmSubmit({
                      title: `Send a sign-in link to ${soleContact.email}?`,
                      description:
                        "This emails them a one-time link to sign in to the partner portal.",
                      confirmLabel: "Send link",
                    })}
                  >
                    <input type="hidden" name="intent" value="send-signin-link" />
                    <button
                      type="submit"
                      className="text-xs text-dark-blue hover:underline whitespace-nowrap"
                    >
                      {soleContact.userId ? "Resend sign-in link" : "Send sign-in link"}
                    </button>
                  </Form>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Add this person's email in Settings to set up their portal access.
              </p>
            )
          ) : (
            <>
              {inviting && canEdit && (
                <Form
                  method="post"
                  onSubmit={confirmSubmit({
                    title: "Send partner invite?",
                    description: "This emails a join link to the address you entered.",
                    confirmLabel: "Send invite",
                  })}
                  className="flex flex-wrap items-end gap-3 bg-muted/20 rounded-lg p-3"
                >
                  <input type="hidden" name="intent" value="invite" />
                  <div className="flex-1 min-w-[200px]">
                    <label className="block text-xs font-medium text-muted-foreground mb-1">
                      Email
                    </label>
                    <input name="email" type="email" required className={inputClass} />
                  </div>
                  <div className="flex-1 min-w-[160px]">
                    <label className="block text-xs font-medium text-muted-foreground mb-1">
                      Role (optional)
                    </label>
                    <input name="displayRole" placeholder="e.g. CTO" className={inputClass} />
                  </div>
                  <Tooltip content="Emails a join link to this address">
                    <button
                      type="submit"
                      className="rounded-lg bg-dark-blue text-white text-sm font-medium px-4 py-2 hover:opacity-90 transition"
                    >
                      Send invite
                    </button>
                  </Tooltip>
                </Form>
              )}

              {org.memberships.length === 0 && pendingInvites.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No members yet{canEdit ? ". Invite the first contact." : "."}
                </p>
              ) : (
                <ul className="divide-y divide-border">
                  {org.memberships.map((m) => (
                    <li key={m.id} className="py-2.5 flex flex-col gap-2">
                      <div className="flex items-center gap-3">
                        <div className="min-w-0 flex-1">
                          <Link
                            to={`/core/partners/contacts/${m.contact.id}`}
                            className="text-sm font-medium text-foreground hover:underline"
                          >
                            {memberName(m.contact)}
                          </Link>
                          {org.primaryContactId === m.id && (
                            <span className="ml-2 text-xs rounded-full bg-accent-teal/15 text-accent-teal px-2 py-0.5">
                              Primary contact
                            </span>
                          )}
                          <div className="text-xs text-muted-foreground">
                            {m.contact.email ?? "no email"}
                            {m.contact.title ? ` · ${m.contact.title}` : ""}
                            {m.role ? ` · ${m.role}` : ""}
                          </div>
                        </div>
                        {canEdit && org.primaryContactId !== m.id && (
                          <Form method="post">
                            <input type="hidden" name="intent" value="member-set-primary" />
                            <input type="hidden" name="membershipId" value={m.id} />
                            <button
                              type="submit"
                              className="text-xs text-muted-foreground hover:text-foreground transition whitespace-nowrap"
                            >
                              Set primary
                            </button>
                          </Form>
                        )}
                        {canEdit && otherOrgs.length > 0 && (
                          <button
                            type="button"
                            onClick={() =>
                              setMovingId(movingId === m.id ? null : m.id)
                            }
                            className="text-xs text-muted-foreground hover:text-foreground transition"
                          >
                            Move
                          </button>
                        )}
                        {canEdit && (
                          <Form
                            method="post"
                            onSubmit={confirmSubmit({
                              title: `Remove ${memberName(m.contact)} from ${org.name}?`,
                              description: "They lose portal access immediately.",
                              confirmLabel: "Remove",
                              tone: "destructive",
                            })}
                          >
                            <input type="hidden" name="intent" value="member-remove" />
                            <input type="hidden" name="partnerUserId" value={m.id} />
                            <button
                              type="submit"
                              className="text-xs text-muted-foreground hover:text-destructive transition"
                            >
                              Remove
                            </button>
                          </Form>
                        )}
                      </div>
                      {canEdit && movingId === m.id && (
                        <Form
                          method="post"
                          className="flex items-center gap-2 bg-muted/20 rounded-lg p-2.5"
                          onSubmit={confirmSubmit({
                            title: `Move ${memberName(m.contact)} to the selected organization?`,
                            description: "Their portal access switches immediately.",
                            confirmLabel: "Move",
                          })}
                        >
                          <input type="hidden" name="intent" value="member-move" />
                          <input type="hidden" name="partnerUserId" value={m.id} />
                          <Select
                            name="targetOrgId"
                            required
                            defaultValue=""
                            placeholder="Move to…"
                            options={otherOrgs.map((o) => ({ value: o.id, label: o.name }))}
                            buttonClassName="flex-1 px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground inline-flex items-center justify-between gap-1 transition-colors hover:bg-muted/40"
                          />
                          <button
                            type="submit"
                            className="px-3 py-1.5 text-xs font-medium rounded-md bg-dark-blue text-white hover:opacity-90 transition"
                          >
                            Move
                          </button>
                          <button
                            type="button"
                            onClick={() => setMovingId(null)}
                            className="px-3 py-1.5 text-xs font-medium rounded-md border border-border hover:bg-muted transition"
                          >
                            Cancel
                          </button>
                        </Form>
                      )}
                    </li>
                  ))}
                  {pendingInvites.map((inv) => (
                    <li key={inv.id} className="py-2.5 flex items-center gap-3">
                      <Mail className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                      <div className="min-w-0 flex-1">
                        <span className="text-sm text-foreground">{inv.email}</span>
                        <span className="ml-2 text-xs rounded-full bg-muted text-muted-foreground px-2 py-0.5">
                          Invited
                        </span>
                        <div className="text-xs text-muted-foreground">
                          Expires {new Date(inv.expiresAt).toLocaleDateString()}
                          {inv.displayRole ? ` · ${inv.displayRole}` : ""}
                        </div>
                      </div>
                      {canEdit && (
                        <Form
                          method="post"
                          onSubmit={confirmSubmit({
                            title: `Revoke invite for ${inv.email}?`,
                            description: "Their invite link will stop working.",
                            confirmLabel: "Revoke",
                            tone: "destructive",
                          })}
                        >
                          <input type="hidden" name="intent" value="revoke-invite" />
                          <input type="hidden" name="inviteId" value={inv.id} />
                          <button
                            type="submit"
                            className="text-xs text-muted-foreground hover:text-destructive transition"
                          >
                            Revoke
                          </button>
                        </Form>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </section>
      )}

      {tab === "applications" && (
        <section className="bg-card border border-border rounded-lg p-4 flex flex-col gap-3">
          <h2 className="font-heading font-semibold text-foreground">Applications</h2>
          {org.applications.length === 0 ? (
            <p className="text-sm text-muted-foreground">No applications.</p>
          ) : (
            <ul className="divide-y divide-border">
              {org.applications.map((a) => (
                <li key={a.id} className="py-2.5 flex items-center gap-3 flex-wrap">
                  <Link
                    to={`/core/partners/applications/${a.id}`}
                    className="text-sm font-medium text-foreground hover:underline flex-1 min-w-0 truncate"
                  >
                    {a.title}
                  </Link>
                  <span
                    className={`text-xs rounded-full px-2 py-0.5 ${PARTNER_STAGE_PILL[a.stage]}`}
                  >
                    {PARTNER_STAGE_LABELS[a.stage]}
                  </span>
                  {a.nextStep && (
                    <span className="text-xs text-muted-foreground">{a.nextStep}</span>
                  )}
                  <span className="text-xs text-muted-foreground whitespace-nowrap">
                    {relativeTime(a.lastActivityAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {tab === "projects" && (
        <section className="bg-card border border-border rounded-lg p-4 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="font-heading font-semibold text-foreground flex items-center gap-2">
              <FolderKanban className="w-4 h-4" /> Funded projects
            </h2>
            {canEdit && linkableProjects.length > 0 && (
              <button
                type="button"
                onClick={() => setLinking((v) => !v)}
                className="text-sm text-dark-blue hover:underline"
              >
                + Link project
              </button>
            )}
          </div>

          {linking && canEdit && (
            <Form
              method="post"
              className="flex flex-wrap items-end gap-3 bg-muted/20 rounded-lg p-3"
            >
              <input type="hidden" name="intent" value="project-link" />
              <div className="flex-1 min-w-[240px]">
                <label className="block text-xs font-medium text-muted-foreground mb-1">
                  Project
                </label>
                <Select
                  name="projectId"
                  required
                  defaultValue=""
                  placeholder="Select a project…"
                  options={linkableProjects.map((p) => ({ value: p.id, label: p.name }))}
                  buttonClassName={`${inputClass} inline-flex items-center justify-between gap-1 transition-colors hover:bg-muted/40`}
                />
              </div>
              <button
                type="submit"
                className="rounded-lg bg-dark-blue text-white text-sm font-medium px-4 py-2 hover:opacity-90 transition"
              >
                Link
              </button>
            </Form>
          )}

          {org.projects.length === 0 ? (
            <p className="text-sm text-muted-foreground">No linked projects.</p>
          ) : (
            <ul className="divide-y divide-border">
              {org.projects.map((pp) => (
                <li key={pp.id} className="py-2.5 flex flex-col gap-2">
                  <div className="flex items-center gap-3">
                    <ProjectIcon iconEmoji={pp.project.iconEmoji} />
                    <div className="min-w-0 flex-1">
                      <Link
                        to={`/projects/${pp.project.id}`}
                        className="text-sm font-medium text-foreground hover:underline"
                      >
                        {pp.project.name}
                      </Link>
                      <span
                        className={`ml-2 text-xs rounded-full px-2 py-0.5 ${
                          pp.active
                            ? "bg-accent-teal/15 text-accent-teal"
                            : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {pp.active ? "Active" : pp.project.status === "Archived" ? "Archived" : "Ended"}
                      </span>
                      <div className="text-xs text-muted-foreground">
                        {pp.startedAt
                          ? `Since ${new Date(pp.startedAt).toLocaleDateString()}`
                          : "No start date"}
                        {pp.endedAt
                          ? ` · Ended ${new Date(pp.endedAt).toLocaleDateString()}`
                          : ""}
                      </div>
                    </div>
                    {canEdit && (
                      <button
                        type="button"
                        onClick={() =>
                          setManagingId(managingId === pp.id ? null : pp.id)
                        }
                        className="text-xs text-muted-foreground hover:text-foreground transition"
                      >
                        Manage
                      </button>
                    )}
                  </div>
                  {/* End/Unlink change what the partner can see — kept behind a
                      disclosure + confirm so neither is a stray one-click. */}
                  {canEdit && managingId === pp.id && (
                    <div className="flex items-center gap-3 bg-muted/20 rounded-lg p-2.5 flex-wrap">
                      <p className="text-xs text-muted-foreground flex-1 min-w-[220px]">
                        Ending keeps the history and closes the partner's live
                        access. Unlinking deletes the partnership record
                        entirely.
                      </p>
                      {!pp.endedAt && (
                        <Form
                          method="post"
                          onSubmit={confirmSubmit({
                            title: `End the partnership on ${pp.project.name}?`,
                            description:
                              "The partner loses live access to it; the record stays.",
                            confirmLabel: "End partnership",
                            tone: "destructive",
                          })}
                        >
                          <input type="hidden" name="intent" value="project-end" />
                          <input type="hidden" name="projectPartnerId" value={pp.id} />
                          <button
                            type="submit"
                            className="px-3 py-1.5 text-xs font-medium rounded-md border border-border hover:bg-muted transition"
                          >
                            End partnership
                          </button>
                        </Form>
                      )}
                      <Form
                        method="post"
                        onSubmit={confirmSubmit({
                          title: `Unlink ${pp.project.name}?`,
                          description:
                            "This deletes the partnership record. Prefer “End partnership” to keep history.",
                          confirmLabel: "Unlink",
                          tone: "destructive",
                        })}
                      >
                        <input type="hidden" name="intent" value="project-unlink" />
                        <input type="hidden" name="projectPartnerId" value={pp.id} />
                        <Tooltip content="Unlink project">
                          <button
                            type="submit"
                            aria-label="Unlink project"
                            className="inline-flex items-center justify-center p-1.5 rounded-md border border-destructive/40 text-destructive hover:bg-destructive/10 transition"
                          >
                            <Unlink className="w-3.5 h-3.5" />
                          </button>
                        </Tooltip>
                      </Form>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {tab === "finance" && financeEnabled && (
        <div className="flex flex-col gap-4">
          <section className="bg-card border border-border rounded-lg p-4 flex flex-col gap-3">
            <h2 className="font-heading font-semibold text-foreground">Deal terms</h2>
            {org.applications.filter((a) => a.stage === "Accepted").length === 0 ? (
              <p className="text-sm text-muted-foreground">No accepted applications yet.</p>
            ) : (
              <ul className="divide-y divide-border">
                {org.applications
                  .filter((a) => a.stage === "Accepted")
                  .map((a) => (
                    <li key={a.id} className="py-2.5 flex items-center gap-3 flex-wrap">
                      <Link
                        to={`/core/partners/applications/${a.id}`}
                        className="text-sm font-medium text-foreground hover:underline flex-1 min-w-0 truncate"
                      >
                        {a.title}
                      </Link>
                      <span className="text-xs text-muted-foreground">
                        {a.fundingType ? PROJECT_FUNDING_TYPE_LABELS[a.fundingType] : "Funding type not set"}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {a.feeCents != null ? formatUsd(a.feeCents / 100) : "No fee set"}
                      </span>
                    </li>
                  ))}
              </ul>
            )}
          </section>

          <section className="bg-card border border-border rounded-lg p-4 flex flex-col gap-3">
            <h2 className="font-heading font-semibold text-foreground">Chart strings</h2>
            {chartStrings.length === 0 ? (
              <p className="text-sm text-muted-foreground">No chart strings on file.</p>
            ) : (
              <ul className="divide-y divide-border">
                {chartStrings.map((cs) => (
                  <li key={cs.id} className="py-2.5 flex items-center gap-3 flex-wrap">
                    <span className="text-sm font-mono text-foreground">{cs.raw}</span>
                    <span className="text-xs text-muted-foreground">{cs.termCode}</span>
                    <span className="text-xs text-muted-foreground">{cs.projectName}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <InvoicesPanel orgId={org.id} invoices={org.invoices} canEdit={canEdit} />
        </div>
      )}

      {tab === "settings" && (
        <div className="flex flex-col gap-4">
          <Form method="post" ref={detailsFormRef}>
            <EditableSection
              title="Details"
              icon={<Building2 className="w-4 h-4" />}
              canEdit={canEdit}
              onSave={() => {
                if (detailsFormRef.current) submit(detailsFormRef.current);
              }}
            >
              {({ editing }) => (
                <DetailsFields org={org} editing={editing} allContacts={allContacts} />
              )}
            </EditableSection>
          </Form>

          {canEdit && <MergeOrgCard org={org} otherOrgs={otherOrgs} />}

          {/* Cleanup for duplicate-org husks — only offered when truly empty. */}
          {canDeleteOrg && (
            <section className="border border-destructive/30 rounded-lg p-4 flex items-center justify-between gap-3 flex-wrap">
              <div>
                <h2 className="text-sm font-semibold text-foreground">
                  Delete organization
                </h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  No members, projects, applications, or pending invites. This
                  organization can be removed.
                </p>
              </div>
              <Form
                method="post"
                onSubmit={confirmSubmit({
                  title: `Delete ${org.name}?`,
                  description: "This can't be undone.",
                  confirmLabel: "Delete",
                  tone: "destructive",
                })}
              >
                <input type="hidden" name="intent" value="org-delete" />
                <button
                  type="submit"
                  className="px-3 py-1.5 text-sm font-medium rounded-md border border-destructive/40 text-destructive hover:bg-destructive/10 transition"
                >
                  Delete organization
                </button>
              </Form>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
