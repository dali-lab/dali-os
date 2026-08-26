import { useRef, useState } from "react";
import {
  Form,
  Link,
  redirect,
  useActionData,
  useLoaderData,
  useSubmit,
} from "react-router";
import { Select, type SelectOption } from "~/components/ui/floating";
import { Building2, FolderKanban, Mail, Users, Unlink } from "lucide-react";
import { Checkbox } from "~/components/ui/Checkbox";
import { Tooltip } from "~/components/ui/floating";
import { useConfirmSubmit } from "~/components/ui/dialog";
import { ProjectIcon } from "~/components/ProjectIcon";
import type { Route } from "./+types/partners.$orgId";
import { requireAuth } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { recordRouteVisit } from "~/lib/user-pages.server";
import { prisma } from "~/lib/db";
import { canViewStaffing, isCore } from "~/lib/roles";
import { logAuditEvent } from "~/lib/audit";
import { resolvePhotoUrl } from "~/lib/photo";
import { EditableSection } from "~/components/EditableSection";
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
  PARTNER_APPLICATION_STATUS_LABELS,
  PARTNER_APPLICATION_STATUS_PILL,
} from "../lib/partner-application";

export const meta: Route.MetaFunction = ({ data }) => {
  const name = (data as { org?: { name: string } } | undefined)?.org?.name;
  return [{ title: name ? `${name} · DALI OS` : "Organization · DALI OS" }];
};

export const handle = {
  breadcrumb: (data: unknown) => {
    const org = (data as { org?: { name: string } } | undefined)?.org;
    return org?.name;
  },
  favoriteRoute: true,
};

export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  if (auth.user.type === "applicant") return redirect("/portal");
  if (!(await canViewStaffing(auth.user.sub))) return redirect("/");

  const canEdit = await isCore(auth.user.sub);
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
            },
          },
        },
      },
      projects: {
        orderBy: { startedAt: "desc" },
        select: {
          id: true,
          startedAt: true,
          endedAt: true,
          project: { select: { id: true, name: true, status: true, iconEmoji: true } },
        },
      },
      applications: {
        orderBy: { createdAt: "desc" },
        select: { id: true, title: true, status: true, createdAt: true },
      },
    },
  });
  if (!org) throw new Response("Not found", { status: 404 });

  // After the gate, so a 404 never lands in someone's recents. Detached — a
  // failed bookkeeping write must not cost the reader their org page.
  recordRouteVisit(auth.user.sub, `/partners/${org.id}`, org.name, request);

  const [pendingInvites, linkableProjects, otherOrgs] = await Promise.all([
    canEdit ? listPendingInvites(org.id) : Promise.resolve([]),
    canEdit
      ? prisma.project.findMany({
          where: {
            status: { not: "Archived" },
            partners: { none: { partnerOrgId: org.id } },
          },
          orderBy: { name: "asc" },
          select: { id: true, name: true },
        })
      : Promise.resolve([]),
    // Targets for the "move member" fix-it action.
    canEdit
      ? prisma.partnerOrg.findMany({
          where: { id: { not: org.id } },
          orderBy: { name: "asc" },
          select: { id: true, name: true },
        })
      : Promise.resolve([]),
  ]);

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
    },
    pendingInvites,
    linkableProjects,
    otherOrgs,
    // Cleanup affordance for duplicate-org husks: deletable only when truly
    // empty (the action re-validates with authoritative counts).
    canDeleteOrg:
      canEdit &&
      org.memberships.length === 0 &&
      org.projects.length === 0 &&
      org.applications.length === 0 &&
      pendingInvites.length === 0,
    canEdit,
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
    select: { id: true, primaryContactId: true },
  });
  if (!org) throw new Response("Not found", { status: 404 });

  const form = await request.formData();
  const intent = form.get("intent") as string;
  const actor = { actorUserId: auth.user.sub, request };

  if (intent === "org-details") {
    const name = (form.get("name") as string | null)?.trim() ?? "";
    if (!name) return { error: "A name is required." };
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
        isIndividual: form.get("isIndividual") === "on",
        primaryContactId,
      },
    });
    await logAuditEvent({
      action: "partner.org.update",
      userId: auth.user.sub,
      targetId: org.id,
      request,
    });
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
    if (memberCount || projectCount || applicationCount || pendingInviteCount) {
      return {
        error:
          "Only an empty organization can be deleted — this one still has members, projects, applications, or a pending invite.",
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
    return redirect(embed ? "/partners?embed=1" : "/partners");
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
    return "error" in result ? result : { ok: true };
  }

  if (intent === "project-end") {
    const projectPartnerId = form.get("projectPartnerId") as string;
    const existing = await prisma.projectPartner.findFirst({
      where: { id: projectPartnerId, partnerOrgId: org.id },
      select: { startedAt: true },
    });
    if (!existing) return { error: "Partnership not found." };
    const result = await updateProjectPartnerDates(
      { projectPartnerId, startedAt: existing.startedAt, endedAt: new Date() },
      actor,
    );
    return "error" in result ? result : { ok: true };
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

  return { error: "Unknown action." };
}

function memberName(c: { name: string; email: string | null }) {
  return c.name || c.email || "Unnamed";
}

export default function PartnerOrgDetail() {
  const { org, pendingInvites, linkableProjects, otherOrgs, canDeleteOrg, canEdit } =
    useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const confirmSubmit = useConfirmSubmit();
  const detailsFormRef = useRef<HTMLFormElement>(null);
  const [inviting, setInviting] = useState(false);
  const [linking, setLinking] = useState(false);
  // Which member row has the "move to another org" form open.
  const [movingId, setMovingId] = useState<string | null>(null);
  // Which project row has its End/Unlink actions revealed.
  const [managingId, setManagingId] = useState<string | null>(null);

  const error = actionData && "error" in actionData ? actionData.error : null;

  const inputClass =
    "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm";

  return (
    <div className="flex flex-col gap-6 max-w-4xl">
      <div className="flex items-center gap-4">
        {org.logoDisplayUrl ? (
          <img
            src={org.logoDisplayUrl}
            alt=""
            className="w-12 h-12 rounded-lg object-contain bg-background border border-border"
          />
        ) : (
          <div className="w-12 h-12 rounded-lg bg-brand-tint text-dark-blue flex items-center justify-center font-bold text-lg">
            {org.name.slice(0, 1)}
          </div>
        )}
        <div className="min-w-0">
          <h1 className="font-heading text-2xl font-bold text-foreground truncate">
            {org.name}
          </h1>
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
        </div>
      </div>

      {error && (
        <p className="text-sm text-destructive bg-destructive/10 rounded-lg px-4 py-3">
          {error}
        </p>
      )}

      {/* Details */}
      <Form method="post" ref={detailsFormRef}>
        <EditableSection
          title="Details"
          icon={<Building2 className="w-4 h-4" />}
          canEdit={canEdit}
          onSave={() => {
            if (detailsFormRef.current) submit(detailsFormRef.current);
          }}
        >
          {({ editing, resetKey }) => (
            <div key={resetKey} className="grid gap-3 sm:grid-cols-2">
              <input type="hidden" name="intent" value="org-details" />
              <div>
                <div className="text-xs font-medium text-muted-foreground mb-1">Name</div>
                {editing ? (
                  <input name="name" defaultValue={org.name} required className={inputClass} />
                ) : (
                  <div className="text-sm text-foreground">{org.name}</div>
                )}
              </div>
              <div>
                <div className="text-xs font-medium text-muted-foreground mb-1">Website</div>
                {editing ? (
                  <input name="website" defaultValue={org.website ?? ""} className={inputClass} />
                ) : (
                  <div className="text-sm text-foreground">{org.website ?? "—"}</div>
                )}
              </div>
              <div>
                <div className="text-xs font-medium text-muted-foreground mb-1">Logo URL</div>
                {editing ? (
                  <input name="logoUrl" defaultValue={org.logoUrl ?? ""} className={inputClass} />
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
                    buttonClassName={`${inputClass} inline-flex items-center justify-between gap-1 transition-colors hover:bg-muted/40`}
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
              {editing ? (
                <Checkbox
                  name="isIndividual"
                  defaultChecked={org.isIndividual}
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
            </div>
          )}
        </EditableSection>
      </Form>

      {/* Members */}
      <section className="bg-card border border-border rounded-lg p-4 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="font-heading font-semibold text-foreground flex items-center gap-2">
            <Users className="w-4 h-4" /> Members
          </h2>
          {canEdit && (
            <button
              type="button"
              onClick={() => setInviting((v) => !v)}
              className="text-sm text-dark-blue hover:underline"
            >
              + Invite member
            </button>
          )}
        </div>

        {inviting && canEdit && (
          <Form
            method="post"
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
            <button
              type="submit"
              className="rounded-lg bg-dark-blue text-white text-sm font-medium px-4 py-2 hover:opacity-90 transition"
            >
              Send invite
            </button>
          </Form>
        )}

        {org.memberships.length === 0 && pendingInvites.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No members yet{canEdit ? " — invite the first contact." : "."}
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {org.memberships.map((m) => (
              <li key={m.id} className="py-2.5 flex flex-col gap-2">
                <div className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <span className="text-sm font-medium text-foreground">
                      {memberName(m.contact)}
                    </span>
                    {org.primaryContactId === m.id && (
                      <span className="ml-2 text-xs rounded-full bg-accent-teal/15 text-accent-teal px-2 py-0.5">
                        Primary contact
                      </span>
                    )}
                    <div className="text-xs text-muted-foreground">
                      {m.contact.email ?? "no email"}
                      {m.role ? ` · ${m.role}` : ""}
                    </div>
                  </div>
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
                  <Form method="post">
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
      </section>

      {/* Projects */}
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
                          "This deletes the partnership record — prefer “End partnership” to keep history.",
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

      {/* Applications */}
      <section className="bg-card border border-border rounded-lg p-4 flex flex-col gap-3">
        <h2 className="font-heading font-semibold text-foreground">Applications</h2>
        {org.applications.length === 0 ? (
          <p className="text-sm text-muted-foreground">No applications.</p>
        ) : (
          <ul className="divide-y divide-border">
            {org.applications.map((a) => (
              <li key={a.id} className="py-2.5 flex items-center gap-3">
                <Link
                  to={`/partners/applications/${a.id}`}
                  className="text-sm font-medium text-foreground hover:underline flex-1 min-w-0 truncate"
                >
                  {a.title}
                </Link>
                <span
                  className={`text-xs rounded-full px-2 py-0.5 ${PARTNER_APPLICATION_STATUS_PILL[a.status]}`}
                >
                  {PARTNER_APPLICATION_STATUS_LABELS[a.status]}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Cleanup for duplicate-org husks — only offered when truly empty. */}
      {canDeleteOrg && (
        <section className="border border-destructive/30 rounded-lg p-4 flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-sm font-semibold text-foreground">
              Delete organization
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              No members, projects, applications, or pending invites — this
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
  );
}
