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
import { Select, Combobox } from "~/components/ui/floating";
import {
  ArrowRightLeft,
  AtSign,
  Building2,
  Eye,
  Globe,
  Image as ImageIcon,
  Landmark,
  Mail,
  MapPin,
  Pencil,
  Plus,
  Settings2,
  Star,
  Tag,
  Tags,
  Unlink,
  User,
  UserMinus,
  UserPlus,
  X,
} from "lucide-react";
import { Checkbox } from "~/components/ui/Checkbox";
import { Button } from "~/components/ui/Button";
import { IconButton } from "~/components/ui/IconButton";
import { useConfirmSubmit, useDialog } from "~/components/ui/dialog";
import { useOsChrome } from "~/components/os-chrome";
import {
  DetailEditRow,
  DetailRow,
  OS_DETAIL_CARD,
  OS_DETAIL_ICON,
  OsTabBar,
} from "~/components/os-page";
import { ProjectIcon } from "~/components/ProjectIcon";
import type { Route } from "./+types/core.partners.orgs.$orgId";
import { requireAuth, isNonMember } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { recordRouteVisit } from "~/lib/user-pages.server";
import { prisma } from "~/lib/db.server";
import { isCore } from "~/lib/roles";
import { cn } from "~/lib/cn";
import { coreHandle } from "~/core/coreNav";
import { logAuditEvent } from "~/lib/audit";
import { resolvePhotoUrl } from "~/lib/photo";
import { relativeTime } from "~/lib/relative-time";
import { formatUsd } from "~/lib/money";
import { PROJECT_FUNDING_TYPE_LABELS } from "~/lib/chart-string";
import { EditableSection } from "~/components/EditableSection";
import { PartnerActivityFeed } from "../components/PartnerActivityFeed";
import { loadPartnerActivityPage } from "../lib/partner-activity-page.server";
import { OrgAvatar } from "../components/org/OrgAvatar";
import { ContactAvatar } from "../components/contact/ContactAvatar";
import {
  DotPill,
  OrgStatusPill,
  OrgTypePill,
  PartnerStagePill,
} from "../components/org/OrgStatusPill";
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
  if (await isNonMember(auth, request)) return redirect("/portal");
  const canEdit = await isCore(auth.user.sub);
  if (!canEdit) return redirect("/");

  const now = new Date();

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

const ORG_TAB_LABELS: Record<OrgTab, string> = {
  timeline: "Timeline",
  contacts: "Contacts",
  applications: "Applications",
  projects: "Projects",
  finance: "Finance",
  settings: "Settings",
};

// The Settings tab's facts card. Individuals show Name + Email (both stored on
// the sole contact) and hide the org-only Website/Logo/Primary-contact fields.
// The Individual checkbox is controlled so toggling it swaps the fields live;
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
  const { formClass, formTrigger } = useOsChrome();
  const [individual, setIndividual] = useState(org.isIndividual);
  const [showcaseConsent, setShowcaseConsent] = useState(org.showcaseConsent);
  const [referredByContactId, setReferredByContactId] = useState(
    org.referredByContactId ?? "",
  );
  const soleContact = org.memberships[0]?.contact ?? null;
  const ic = OS_DETAIL_ICON;
  const dash = <span className="text-os-muted">—</span>;

  if (editing) {
    return (
      <div
        className={cn(OS_DETAIL_CARD, "pb-2 pt-1", formClass, "grid grid-cols-[max-content_1fr]")}
      >
        <input type="hidden" name="intent" value="org-details" />
        <input type="hidden" name="showcaseConsent" value={showcaseConsent ? "on" : ""} />
        <input type="hidden" name="referredByContactId" value={referredByContactId} />
        <DetailEditRow icon={<Building2 className={ic} />} label="Name">
          <input name="name" type="text" defaultValue={org.name} required className="w-full" />
        </DetailEditRow>
        {individual ? (
          <DetailEditRow icon={<AtSign className={ic} />} label="Email">
            <input
              name="email"
              type="email"
              required
              defaultValue={soleContact?.email ?? ""}
              className="w-full"
            />
          </DetailEditRow>
        ) : (
          <>
            <DetailEditRow icon={<Globe className={ic} />} label="Website">
              <input
                name="website"
                type="text"
                defaultValue={org.website ?? ""}
                className="w-full"
              />
            </DetailEditRow>
            <DetailEditRow icon={<ImageIcon className={ic} />} label="Logo URL">
              <input
                name="logoUrl"
                type="text"
                defaultValue={org.logoUrl ?? ""}
                className="w-full"
              />
            </DetailEditRow>
            <DetailEditRow icon={<Star className={ic} />} label="Primary contact">
              <Select
                name="primaryContactId"
                defaultValue={org.primaryContactId ?? ""}
                options={[
                  { value: "", label: "None" },
                  ...org.memberships.map((m) => ({ value: m.id, label: memberName(m.contact) })),
                ]}
              />
            </DetailEditRow>
          </>
        )}
        <DetailEditRow icon={<Tag className={ic} />} label="Type">
          <Select
            name="type"
            defaultValue={org.type ?? ""}
            options={[
              { value: "", label: "Not set" },
              ...PARTNER_ORG_TYPES.map((t) => ({ value: t, label: PARTNER_ORG_TYPE_LABELS[t] })),
            ]}
          />
        </DetailEditRow>
        <DetailEditRow icon={<Landmark className={ic} />} label="Legal entity name">
          <input
            name="legalEntityName"
            type="text"
            defaultValue={org.legalEntityName ?? ""}
            className="w-full"
          />
        </DetailEditRow>
        <DetailEditRow icon={<MapPin className={ic} />} label="Address">
          <input name="address" type="text" defaultValue={org.address ?? ""} className="w-full" />
        </DetailEditRow>
        <DetailEditRow icon={<Tags className={ic} />} label="Tags">
          <input
            name="tags"
            type="text"
            defaultValue={org.tags.join(", ")}
            placeholder="comma-separated"
            className="w-full"
          />
        </DetailEditRow>
        <DetailEditRow icon={<UserPlus className={ic} />} label="Referred by">
          <Combobox
            value={referredByContactId}
            onChange={setReferredByContactId}
            ariaLabel="Referred by"
            placeholder="None"
            options={[
              { value: "", label: "None" },
              ...allContacts.map((c) => ({ value: c.id, label: c.name || c.email || c.id })),
            ]}
            className={cn(formTrigger, "flex border-os-container")}
          />
        </DetailEditRow>
        <DetailEditRow icon={<User className={ic} />} label="Individual">
          <Checkbox
            name="isIndividual"
            checked={individual}
            onChange={(e) => setIndividual(e.target.checked)}
            label="A single person, not an organization"
            className="text-sm text-foreground"
          />
        </DetailEditRow>
        <DetailEditRow icon={<Eye className={ic} />} label="Showcase consent">
          <Checkbox
            checked={showcaseConsent}
            onChange={(e) => setShowcaseConsent(e.target.checked)}
            label="The partner agreed to be named on the public showcase"
            className="text-sm text-foreground"
          />
        </DetailEditRow>
        <div className="col-span-2 flex flex-col gap-2 py-3">
          <span className="flex items-center gap-2.5 text-sm text-os-grey">
            <Pencil className={ic} />
            Notes
          </span>
          <textarea name="notes" defaultValue={org.notes ?? ""} rows={3} className="w-full" />
        </div>
      </div>
    );
  }

  return (
    <div className={OS_DETAIL_CARD}>
      <DetailRow icon={<Building2 className={ic} />} label="Name">
        {org.name}
      </DetailRow>
      {org.isIndividual ? (
        <DetailRow icon={<AtSign className={ic} />} label="Email">
          {soleContact?.email ?? dash}
        </DetailRow>
      ) : (
        <>
          <DetailRow icon={<Globe className={ic} />} label="Website">
            {org.website ?? dash}
          </DetailRow>
          <DetailRow icon={<ImageIcon className={ic} />} label="Logo URL">
            {org.logoUrl ? <span className="break-all">{org.logoUrl}</span> : dash}
          </DetailRow>
          <DetailRow icon={<Star className={ic} />} label="Primary contact">
            {org.memberships.find((m) => m.id === org.primaryContactId)
              ? memberName(org.memberships.find((m) => m.id === org.primaryContactId)!.contact)
              : dash}
          </DetailRow>
        </>
      )}
      <DetailRow icon={<Tag className={ic} />} label="Type">
        {org.type ? PARTNER_ORG_TYPE_LABELS[org.type] : dash}
      </DetailRow>
      <DetailRow icon={<Landmark className={ic} />} label="Legal entity name">
        {org.legalEntityName ?? dash}
      </DetailRow>
      <DetailRow icon={<MapPin className={ic} />} label="Address">
        {org.address ?? dash}
      </DetailRow>
      <DetailRow icon={<Tags className={ic} />} label="Tags">
        {org.tags.length > 0 ? (
          <span className="flex flex-wrap justify-end gap-1.5">
            {org.tags.map((t) => (
              <DotPill key={t}>{t}</DotPill>
            ))}
          </span>
        ) : (
          dash
        )}
      </DetailRow>
      <DetailRow icon={<UserPlus className={ic} />} label="Referred by">
        {allContacts.find((c) => c.id === org.referredByContactId)?.name ?? dash}
      </DetailRow>
      <DetailRow icon={<User className={ic} />} label="Individual">
        {org.isIndividual ? "Yes" : "No"}
      </DetailRow>
      <DetailRow icon={<Eye className={ic} />} label="Showcase consent">
        {org.showcaseConsent ? "Yes" : "No"}
      </DetailRow>
      <div className="flex flex-col gap-2 py-3">
        <span className="flex items-center gap-2.5 text-sm text-os-grey">
          <Pencil className={ic} />
          Notes
        </span>
        <p className="whitespace-pre-wrap text-sm text-foreground">{org.notes ?? "—"}</p>
      </div>
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
  const os = useOsChrome();
  const formRef = useRef<HTMLFormElement>(null);
  if (otherOrgs.length === 0) return null;
  const targetName = otherOrgs.find((o) => o.id === target)?.name ?? "";

  return (
    <section className={os.sectionShell}>
      <h2 className={os.sectionTitle}>Merge into another organization</h2>
      <div className={cn("rounded-os-card bg-os-card", os.panelPad, "flex flex-col gap-3")}>
        <p className="text-sm text-os-grey">
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
            className={cn(os.formTrigger, "min-w-[220px] flex-1 border-os-container")}
          />
          <Form method="post" ref={formRef}>
            <input type="hidden" name="intent" value="org-merge" />
            <input type="hidden" name="survivorOrgId" value={target} />
            <Button
              type="button"
              variant="secondary"
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
            >
              Merge
            </Button>
          </Form>
        </div>
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
    activitiesNextCursor,
    actorNames,
    chartStrings,
    canDeleteOrg,
    canEdit,
  } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const confirmSubmit = useConfirmSubmit();
  const os = useOsChrome();
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

  // An individual partner is a single person — their sole membership's contact.
  const soleContact = org.isIndividual ? org.memberships[0]?.contact ?? null : null;

  const tabParam = searchParams.get("tab");
  const tab: OrgTab = isOrgTab(tabParam) ? tabParam : "timeline";
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

  const websiteHost = org.website?.replace(/^https?:\/\//, "").replace(/\/$/, "");

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-center gap-6">
        <OrgAvatar org={org} size="lg" />
        <div className="min-w-0 flex flex-1 flex-col gap-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex flex-col gap-1">
              <h1 className="font-heading text-[32px] font-medium leading-none text-foreground truncate">
                {org.name}
              </h1>
              <span className="text-[13px] text-os-grey">
                {org.isIndividual ? "Individual partner" : "Partner organization"}
                {websiteHost && (
                  <>
                    {" · "}
                    <a
                      href={org.website!}
                      target="_blank"
                      rel="noreferrer"
                      className="transition-colors hover:text-foreground hover:underline"
                    >
                      {websiteHost}
                    </a>
                  </>
                )}
              </span>
            </div>
            {canEdit && tab !== "settings" && (
              <button type="button" onClick={() => setTab("settings")} className={os.actionBtn()}>
                <Pencil className="h-3.5 w-3.5" />
                Edit
              </button>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <OrgStatusPill status={status as PartnerRelationshipStatus} size="md" />
            <OrgTypePill type={org.type} size="md" />
            {org.tags.map((t) => (
              <DotPill key={t} size="md" className="font-normal text-os-grey">
                {t}
              </DotPill>
            ))}
          </div>
        </div>
      </header>

      <OsTabBar
        ariaLabel="Organization sections"
        tabs={ORG_TAB_VALUES.map((t) => ({ key: t, label: ORG_TAB_LABELS[t] }))}
        active={tab}
        onSelect={setTab}
      />

      {error && (
        <p className="rounded-os-item bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="flex min-h-[25vh] flex-col gap-6">
        {tab === "timeline" && (
          <PartnerActivityFeed
            activities={activities}
            nextCursor={activitiesNextCursor}
            scope={{ orgId: org.id }}
            actorNames={actorNames}
            canEdit={canEdit}
          />
        )}

        {tab === "contacts" && (
          <section className={os.sectionShell}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className={os.sectionTitle}>{org.isIndividual ? "Contact" : "Members"}</h2>
              {!org.isIndividual && canEdit && (
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => setAddingContact((v) => !v)} className={os.quietBtn}>
                    <Plus className="h-3.5 w-3.5" strokeWidth={3} aria-hidden />
                    Add existing contact
                  </button>
                  <button type="button" onClick={() => setInviting((v) => !v)} className={os.quietBtn}>
                    <Plus className="h-3.5 w-3.5" strokeWidth={3} aria-hidden />
                    Invite member
                  </button>
                </div>
              )}
            </div>

            <div className="rounded-os-card bg-os-card px-5">
              {addingContact && canEdit && !org.isIndividual && (
                <Form
                  method="post"
                  onSubmit={() => {
                    setAddingContact(false);
                    setAddContactId("");
                  }}
                  className={cn(
                    os.formClass,
                    "flex flex-wrap items-end gap-3 border-b border-os-container py-4",
                  )}
                >
                  <input type="hidden" name="intent" value="member-add" />
                  <input type="hidden" name="contactId" value={addContactId} />
                  <label className={cn(os.fieldLabel, "min-w-[240px] flex-1")}>
                    <span>Contact</span>
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
                      className={cn(os.formTrigger, "flex border-os-container")}
                    />
                  </label>
                  <Button type="submit" variant="primary" disabled={!addContactId}>
                    Add
                  </Button>
                </Form>
              )}

              {inviting && canEdit && !org.isIndividual && (
                <Form
                  method="post"
                  onSubmit={confirmSubmit({
                    title: "Send partner invite?",
                    description: "This emails a join link to the address you entered.",
                    confirmLabel: "Send invite",
                  })}
                  className={cn(
                    os.formClass,
                    "flex flex-wrap items-end gap-3 border-b border-os-container py-4",
                  )}
                >
                  <input type="hidden" name="intent" value="invite" />
                  <label className={cn(os.fieldLabel, "min-w-[200px] flex-1")}>
                    <span>Email</span>
                    <input name="email" type="email" required className="w-full" />
                  </label>
                  <label className={cn(os.fieldLabel, "min-w-[160px] flex-1")}>
                    <span>Role (optional)</span>
                    <input name="displayRole" type="text" placeholder="e.g. CTO" className="w-full" />
                  </label>
                  <Button type="submit" variant="primary">
                    Send invite
                  </Button>
                </Form>
              )}

              {org.isIndividual ? (
                soleContact ? (
                  <div className="flex items-center gap-3 py-4">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-foreground">
                        {memberName(soleContact)}
                      </div>
                      <div className="text-xs text-os-grey">{soleContact.email ?? "no email"}</div>
                    </div>
                    <DotPill dot={soleContact.userId ? "bg-os-green" : "bg-os-muted"}>
                      {soleContact.userId ? "Active" : "Hasn't signed in"}
                    </DotPill>
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
                        <button type="submit" className={os.actionBtn()}>
                          {soleContact.userId ? "Resend sign-in link" : "Send sign-in link"}
                        </button>
                      </Form>
                    )}
                  </div>
                ) : (
                  <p className="py-6 text-sm text-os-grey">
                    Add this person's email in Settings to set up their portal access.
                  </p>
                )
              ) : org.memberships.length === 0 && pendingInvites.length === 0 ? (
                <p className="py-6 text-sm text-os-grey">
                  No members yet{canEdit ? ". Invite the first contact." : "."}
                </p>
              ) : (
                <ul>
                  {org.memberships.map((m) => (
                    <li
                      key={m.id}
                      className="flex flex-col gap-2 border-b border-os-container py-3 last:border-0"
                    >
                      <div className="flex items-center gap-3">
                        <ContactAvatar contact={m.contact} />
                        <div className="min-w-0 flex-1">
                          <span className="flex items-center gap-2">
                            <Link
                              to={`/core/partners/contacts/${m.contact.id}`}
                              className="text-sm font-medium text-foreground hover:underline"
                            >
                              {memberName(m.contact)}
                            </Link>
                            {org.primaryContactId === m.id && (
                              <DotPill dot="bg-os-accent">Primary</DotPill>
                            )}
                          </span>
                          <div className="text-xs text-os-grey">
                            {m.contact.email ?? "no email"}
                            {m.contact.title ? ` · ${m.contact.title}` : ""}
                            {m.role ? ` · ${m.role}` : ""}
                          </div>
                        </div>
                        {canEdit && org.primaryContactId !== m.id && (
                          <Form method="post">
                            <input type="hidden" name="intent" value="member-set-primary" />
                            <input type="hidden" name="membershipId" value={m.id} />
                            <IconButton type="submit" label="Set primary" icon={Star} />
                          </Form>
                        )}
                        {canEdit && otherOrgs.length > 0 && (
                          <IconButton
                            label="Move"
                            icon={ArrowRightLeft}
                            onClick={() => setMovingId(movingId === m.id ? null : m.id)}
                          />
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
                            <IconButton
                              type="submit"
                              label="Remove"
                              icon={UserMinus}
                              tone="destructive"
                            />
                          </Form>
                        )}
                      </div>
                      {canEdit && movingId === m.id && (
                        <Form
                          method="post"
                          className="flex items-center gap-2 rounded-os-item bg-os-well p-3"
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
                            buttonClassName={cn(os.formTrigger, "flex-1 border-os-container")}
                          />
                          <Button type="submit" variant="primary" size="sm">
                            Move
                          </Button>
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            onClick={() => setMovingId(null)}
                          >
                            Cancel
                          </Button>
                        </Form>
                      )}
                    </li>
                  ))}
                  {pendingInvites.map((inv) => (
                    <li
                      key={inv.id}
                      className="flex items-center gap-3 border-b border-os-container py-3 last:border-0"
                    >
                      <Mail className="h-4 w-4 flex-shrink-0 text-os-grey" aria-hidden />
                      <div className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="text-sm text-foreground">{inv.email}</span>
                          <DotPill dot="bg-os-amber">Invited</DotPill>
                        </span>
                        <div className="text-xs text-os-grey">
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
                          <IconButton
                            type="submit"
                            label="Revoke invite"
                            icon={X}
                            tone="destructive"
                          />
                        </Form>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        )}

        {tab === "applications" && (
          <section className={os.sectionShell}>
            <h2 className={os.sectionTitle}>Applications</h2>
            <div className="rounded-os-card bg-os-card px-5">
              {org.applications.length === 0 ? (
                <p className="py-6 text-sm text-os-grey">No applications.</p>
              ) : (
                <ul>
                  {org.applications.map((a) => (
                    <li
                      key={a.id}
                      className="flex flex-wrap items-center gap-3 border-b border-os-container py-3 last:border-0"
                    >
                      <Link
                        to={`/core/partners/applications/${a.id}`}
                        className="min-w-0 flex-1 truncate text-sm font-medium text-foreground hover:underline"
                      >
                        {a.title}
                      </Link>
                      <PartnerStagePill stage={a.stage} />
                      {a.nextStep && <span className="text-xs text-os-grey">{a.nextStep}</span>}
                      <span className="whitespace-nowrap text-xs text-os-grey">
                        {relativeTime(a.lastActivityAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        )}

        {tab === "projects" && (
          <section className={os.sectionShell}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className={os.sectionTitle}>Funded projects</h2>
              {canEdit && linkableProjects.length > 0 && (
                <button type="button" onClick={() => setLinking((v) => !v)} className={os.quietBtn}>
                  <Plus className="h-3.5 w-3.5" strokeWidth={3} aria-hidden />
                  Link project
                </button>
              )}
            </div>

            <div className="rounded-os-card bg-os-card px-5">
              {linking && canEdit && (
                <Form
                  method="post"
                  className={cn(
                    os.formClass,
                    "flex flex-wrap items-end gap-3 border-b border-os-container py-4",
                  )}
                >
                  <input type="hidden" name="intent" value="project-link" />
                  <label className={cn(os.fieldLabel, "min-w-[240px] flex-1")}>
                    <span>Project</span>
                    <Select
                      name="projectId"
                      required
                      defaultValue=""
                      placeholder="Select a project…"
                      options={linkableProjects.map((p) => ({ value: p.id, label: p.name }))}
                    />
                  </label>
                  <Button type="submit" variant="primary">
                    Link
                  </Button>
                </Form>
              )}

              {org.projects.length === 0 ? (
                <p className="py-6 text-sm text-os-grey">No linked projects.</p>
              ) : (
                <ul>
                  {org.projects.map((pp) => (
                    <li
                      key={pp.id}
                      className="flex flex-col gap-2 border-b border-os-container py-3 last:border-0"
                    >
                      <div className="flex items-center gap-3">
                        <ProjectIcon iconEmoji={pp.project.iconEmoji} />
                        <div className="min-w-0 flex-1">
                          <span className="flex items-center gap-2">
                            <Link
                              to={`/projects/${pp.project.id}`}
                              className="text-sm font-medium text-foreground hover:underline"
                            >
                              {pp.project.name}
                            </Link>
                            <DotPill dot={pp.active ? "bg-os-green" : "bg-os-muted"}>
                              {pp.active
                                ? "Active"
                                : pp.project.status === "Archived"
                                  ? "Archived"
                                  : "Ended"}
                            </DotPill>
                          </span>
                          <div className="text-xs text-os-grey">
                            {pp.startedAt
                              ? `Since ${new Date(pp.startedAt).toLocaleDateString()}`
                              : "No start date"}
                            {pp.endedAt
                              ? ` · Ended ${new Date(pp.endedAt).toLocaleDateString()}`
                              : ""}
                          </div>
                        </div>
                        {canEdit && (
                          <IconButton
                            label="Manage"
                            icon={Settings2}
                            onClick={() => setManagingId(managingId === pp.id ? null : pp.id)}
                          />
                        )}
                      </div>
                      {/* End/Unlink change what the partner can see — kept behind a
                          disclosure + confirm so neither is a stray one-click. */}
                      {canEdit && managingId === pp.id && (
                        <div className="flex flex-wrap items-center gap-3 rounded-os-item bg-os-well p-3">
                          <p className="min-w-[220px] flex-1 text-xs text-os-grey">
                            Ending keeps the history and closes the partner's live access.
                            Unlinking deletes the partnership record entirely.
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
                              <Button type="submit" variant="secondary" size="sm">
                                End partnership
                              </Button>
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
                            <IconButton
                              type="submit"
                              label="Unlink project"
                              icon={Unlink}
                              tone="destructive"
                            />
                          </Form>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        )}

        {tab === "finance" && (
          <>
            <section className={os.sectionShell}>
              <h2 className={os.sectionTitle}>Deal terms</h2>
              <div className="rounded-os-card bg-os-card px-5">
                {org.applications.filter((a) => a.stage === "Accepted").length === 0 ? (
                  <p className="py-6 text-sm text-os-grey">No accepted applications yet.</p>
                ) : (
                  <ul>
                    {org.applications
                      .filter((a) => a.stage === "Accepted")
                      .map((a) => (
                        <li
                          key={a.id}
                          className="flex flex-wrap items-center gap-3 border-b border-os-container py-3 last:border-0"
                        >
                          <Link
                            to={`/core/partners/applications/${a.id}`}
                            className="min-w-0 flex-1 truncate text-sm font-medium text-foreground hover:underline"
                          >
                            {a.title}
                          </Link>
                          <span className="text-xs text-os-grey">
                            {a.fundingType
                              ? PROJECT_FUNDING_TYPE_LABELS[a.fundingType]
                              : "Funding type not set"}
                          </span>
                          <span className="text-xs text-os-grey">
                            {a.feeCents != null ? formatUsd(a.feeCents / 100) : "No fee set"}
                          </span>
                        </li>
                      ))}
                  </ul>
                )}
              </div>
            </section>

            <section className={os.sectionShell}>
              <h2 className={os.sectionTitle}>Chart strings</h2>
              <div className="rounded-os-card bg-os-card px-5">
                {chartStrings.length === 0 ? (
                  <p className="py-6 text-sm text-os-grey">No chart strings on file.</p>
                ) : (
                  <ul>
                    {chartStrings.map((cs) => (
                      <li
                        key={cs.id}
                        className="flex flex-wrap items-center gap-3 border-b border-os-container py-3 last:border-0"
                      >
                        <span className="font-mono text-sm text-foreground">{cs.raw}</span>
                        <span className="text-xs text-os-grey">{cs.termCode}</span>
                        <span className="text-xs text-os-grey">{cs.projectName}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>

            <InvoicesPanel orgId={org.id} invoices={org.invoices} canEdit={canEdit} />
          </>
        )}

        {tab === "settings" && (
          <>
            <Form method="post" ref={detailsFormRef}>
              <EditableSection
                title="Details"
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
              <section className="flex flex-wrap items-center justify-between gap-3 rounded-os-card border border-destructive/30 p-5">
                <div>
                  <h2 className="text-sm font-semibold text-foreground">Delete organization</h2>
                  <p className="mt-0.5 text-xs text-os-grey">
                    No members, projects, applications, or pending invites. This organization can
                    be removed.
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
                  <Button type="submit" variant="destructive">
                    Delete organization
                  </Button>
                </Form>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}
