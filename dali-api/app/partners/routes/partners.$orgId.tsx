import { useRef, useState } from "react";
import {
  Form,
  Link,
  redirect,
  useActionData,
  useLoaderData,
  useSubmit,
} from "react-router";
import { Building2, FolderKanban, Mail, Users } from "lucide-react";
import type { Route } from "./+types/partners.$orgId";
import { requireAuth } from "~/lib/auth";
import { prisma } from "~/lib/db";
import { canViewStaffing, isCore } from "~/lib/roles";
import { logAuditEvent } from "~/lib/audit";
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

export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");
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
      users: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          displayRole: true,
          authProvider: true,
          createdAt: true,
          user: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              personalEmail: true,
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
          project: { select: { id: true, name: true, status: true } },
        },
      },
      applications: {
        orderBy: { createdAt: "desc" },
        select: { id: true, title: true, status: true, createdAt: true },
      },
    },
  });
  if (!org) throw new Response("Not found", { status: 404 });

  const [pendingInvites, linkableProjects] = await Promise.all([
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
  ]);

  return {
    org: {
      ...org,
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
    canEdit,
  };
}

export async function action({ request, params }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");
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
      const contact = await prisma.partnerUser.findFirst({
        where: { id: primaryContactId, partnerOrgId: org.id },
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
    const partnerUserId = form.get("partnerUserId") as string;
    const displayRole =
      (form.get("displayRole") as string | null)?.trim() || null;
    const res = await prisma.partnerUser.updateMany({
      where: { id: partnerUserId, partnerOrgId: org.id },
      data: { displayRole },
    });
    if (res.count !== 1) return { error: "Member not found." };
    await logAuditEvent({
      action: "partner.member.update",
      userId: auth.user.sub,
      targetId: partnerUserId,
      metadata: { partnerOrgId: org.id },
      request,
    });
    return { ok: true };
  }

  if (intent === "member-remove") {
    const partnerUserId = form.get("partnerUserId") as string;
    const member = await prisma.partnerUser.findFirst({
      where: { id: partnerUserId, partnerOrgId: org.id },
      select: { id: true },
    });
    if (!member) return { error: "Member not found." };
    await prisma.$transaction(async (tx) => {
      if (org.primaryContactId === partnerUserId) {
        await tx.partnerOrg.update({
          where: { id: org.id },
          data: { primaryContactId: null },
        });
      }
      await tx.partnerUser.delete({ where: { id: partnerUserId } });
    });
    await logAuditEvent({
      action: "partner.member.remove",
      userId: auth.user.sub,
      targetId: partnerUserId,
      metadata: { partnerOrgId: org.id },
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

function memberName(u: { firstName: string; lastName: string; personalEmail: string | null }) {
  return [u.firstName, u.lastName].filter(Boolean).join(" ") || u.personalEmail || "Unnamed";
}

export default function PartnerOrgDetail() {
  const { org, pendingInvites, linkableProjects, canEdit } =
    useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const detailsFormRef = useRef<HTMLFormElement>(null);
  const [inviting, setInviting] = useState(false);
  const [linking, setLinking] = useState(false);

  const error = actionData && "error" in actionData ? actionData.error : null;

  const inputClass =
    "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm";

  return (
    <div className="flex flex-col gap-6 max-w-4xl">
      <div className="flex items-center gap-4">
        {org.logoUrl ? (
          <img
            src={org.logoUrl}
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
                  <select
                    name="primaryContactId"
                    defaultValue={org.primaryContactId ?? ""}
                    className={inputClass}
                  >
                    <option value="">None</option>
                    {org.users.map((m) => (
                      <option key={m.id} value={m.id}>
                        {memberName(m.user)}
                      </option>
                    ))}
                  </select>
                ) : (
                  <div className="text-sm text-foreground">
                    {memberName(
                      org.users.find((m) => m.id === org.primaryContactId)?.user ?? {
                        firstName: "—",
                        lastName: "",
                        personalEmail: null,
                      },
                    )}
                  </div>
                )}
              </div>
              <label className="flex items-center gap-2 text-sm text-foreground">
                {editing ? (
                  <input
                    type="checkbox"
                    name="isIndividual"
                    defaultChecked={org.isIndividual}
                    className="rounded"
                  />
                ) : (
                  <input type="checkbox" checked={org.isIndividual} disabled className="rounded" />
                )}
                Individual (not an organization)
              </label>
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

        {org.users.length === 0 && pendingInvites.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No members yet{canEdit ? " — invite the first contact." : "."}
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {org.users.map((m) => (
              <li key={m.id} className="py-2.5 flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <span className="text-sm font-medium text-foreground">
                    {memberName(m.user)}
                  </span>
                  {org.primaryContactId === m.id && (
                    <span className="ml-2 text-xs rounded-full bg-accent-teal/15 text-accent-teal px-2 py-0.5">
                      Primary contact
                    </span>
                  )}
                  <div className="text-xs text-muted-foreground">
                    {m.user.personalEmail ?? "no email"}
                    {m.displayRole ? ` · ${m.displayRole}` : ""}
                  </div>
                </div>
                {canEdit && (
                  <Form
                    method="post"
                    onSubmit={(e) => {
                      if (!confirm(`Remove ${memberName(m.user)} from ${org.name}? They lose portal access immediately.`)) {
                        e.preventDefault();
                      }
                    }}
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
              <select name="projectId" required className={inputClass}>
                <option value="">Select a project…</option>
                {linkableProjects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
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
              <li key={pp.id} className="py-2.5 flex items-center gap-3">
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
                {canEdit && !pp.endedAt && (
                  <Form method="post">
                    <input type="hidden" name="intent" value="project-end" />
                    <input type="hidden" name="projectPartnerId" value={pp.id} />
                    <button
                      type="submit"
                      className="text-xs text-muted-foreground hover:text-foreground transition"
                      title="Sets an end date; keeps the history"
                    >
                      End partnership
                    </button>
                  </Form>
                )}
                {canEdit && (
                  <Form
                    method="post"
                    onSubmit={(e) => {
                      if (!confirm(`Unlink ${pp.project.name}? This deletes the partnership record — prefer “End partnership” to keep history.`)) {
                        e.preventDefault();
                      }
                    }}
                  >
                    <input type="hidden" name="intent" value="project-unlink" />
                    <input type="hidden" name="projectPartnerId" value={pp.id} />
                    <button
                      type="submit"
                      className="text-xs text-muted-foreground hover:text-destructive transition"
                    >
                      Unlink
                    </button>
                  </Form>
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
    </div>
  );
}
