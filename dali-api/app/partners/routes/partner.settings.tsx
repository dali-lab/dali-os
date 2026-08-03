import { useState } from "react";
import { Form, useLoaderData, useNavigation } from "react-router";
import type { Route } from "./+types/partner.settings";
import { prisma } from "~/lib/db";
import { logAuditEvent } from "~/lib/audit";
import { resolvePhotoUrl } from "~/lib/photo";
import { PhotoUploadField } from "~/components/PhotoUploadField";
import { buttonClasses } from "~/components/ui/Button";
import { useConfirmSubmit } from "~/components/ui/dialog";
import { requirePartner } from "~/partners/lib/partner-auth.server";
import {
  createPartnerInvite,
  listPendingInvites,
  revokePartnerInvite,
} from "~/partners/lib/invites.server";

export const meta: Route.MetaFunction = () => [
  { title: "Settings · DALI OS" },
];

export async function loader({ request }: Route.LoaderArgs) {
  const { auth, partnerUser, org } = await requirePartner(request);
  const [members, pendingInvites] = await Promise.all([
    prisma.partnerUser.findMany({
      where: { partnerOrgId: org.id },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        displayRole: true,
        user: {
          select: { firstName: true, lastName: true, personalEmail: true },
        },
      },
    }),
    listPendingInvites(org.id),
  ]);
  return {
    me: {
      userId: auth.user.sub,
      firstName: auth.user.firstName,
      lastName: auth.user.lastName,
      displayRole: partnerUser.displayRole,
      partnerUserId: partnerUser.id,
    },
    org,
    logoPreviewUrl: await resolvePhotoUrl(org.logoUrl),
    members,
    pendingInvites,
  };
}

export async function action({ request }: Route.ActionArgs) {
  const { auth, partnerUser, org } = await requirePartner(request);
  const form = await request.formData();
  const intent = form.get("intent") as string;

  if (intent === "profile") {
    const firstName = (form.get("firstName") as string | null)?.trim() ?? "";
    const lastName = (form.get("lastName") as string | null)?.trim() ?? "";
    const displayRole =
      (form.get("displayRole") as string | null)?.trim() || null;
    if (!firstName || !lastName) {
      return { error: "First and last name are required." };
    }
    await prisma.$transaction([
      prisma.user.update({
        where: { id: auth.user.sub },
        data: { firstName, lastName },
      }),
      prisma.partnerUser.update({
        where: { id: partnerUser.id },
        data: { displayRole },
      }),
    ]);
    return { ok: true };
  }

  if (intent === "org") {
    // Any org member may edit — visibility and permissions derive entirely
    // from org membership (schema comment on PartnerUser.displayRole).
    const name = (form.get("name") as string | null)?.trim() ?? "";
    if (!name) return { error: "Organization name is required." };
    await prisma.partnerOrg.update({
      where: { id: org.id },
      data: {
        name,
        website: (form.get("website") as string | null)?.trim() || null,
        logoUrl: (form.get("logoUrl") as string | null)?.trim() || null,
      },
    });
    await logAuditEvent({
      action: "partner.org.update",
      userId: auth.user.sub,
      targetId: org.id,
      metadata: { via: "partner-settings" },
      request,
    });
    return { ok: true };
  }

  if (intent === "set-primary") {
    const targetId = form.get("partnerUserId") as string;
    const target = await prisma.partnerUser.findFirst({
      where: { id: targetId, partnerOrgId: org.id },
      select: { id: true },
    });
    if (!target) return { error: "Member not found." };
    await prisma.partnerOrg.update({
      where: { id: org.id },
      data: { primaryContactId: target.id },
    });
    await logAuditEvent({
      action: "partner.org.update",
      userId: auth.user.sub,
      targetId: org.id,
      metadata: { change: "primary-contact" },
      request,
    });
    return { ok: true };
  }

  if (intent === "remove-member") {
    const targetId = form.get("partnerUserId") as string;
    const target = await prisma.partnerUser.findFirst({
      where: { id: targetId, partnerOrgId: org.id },
      select: { id: true, userId: true },
    });
    if (!target) return { error: "Member not found." };
    if (target.id === partnerUser.id) {
      return { error: "You can't remove yourself." };
    }
    if (org.primaryContactId === target.id) {
      return {
        error: "Assign a new primary contact before removing this member.",
      };
    }
    await prisma.partnerUser.delete({ where: { id: target.id } });
    await logAuditEvent({
      action: "partner.member.remove",
      userId: auth.user.sub,
      targetId: org.id,
      metadata: { removedUserId: target.userId },
      request,
    });
    return { ok: true };
  }

  if (intent === "invite") {
    const result = await createPartnerInvite(
      {
        partnerOrgId: org.id,
        email: (form.get("email") as string | null) ?? "",
        displayRole: (form.get("displayRole") as string | null)?.trim() || null,
        invitedByUserId: auth.user.sub,
      },
      request,
    );
    return "error" in result ? result : { ok: true, invited: true };
  }

  if (intent === "revoke-invite") {
    const result = await revokePartnerInvite(
      {
        inviteId: (form.get("inviteId") as string | null) ?? "",
        partnerOrgId: org.id,
        actorUserId: auth.user.sub,
      },
      request,
    );
    return "error" in result ? result : { ok: true };
  }

  return { error: "Unknown action." };
}

export default function PartnerSettings({ actionData }: Route.ComponentProps) {
  const { me, org, logoPreviewUrl, members, pendingInvites } =
    useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";
  const confirmSubmit = useConfirmSubmit();
  const [inviting, setInviting] = useState(false);
  const error = actionData && "error" in actionData ? actionData.error : null;
  const invited = actionData && "invited" in actionData;

  const inputClass =
    "w-full rounded-xl border border-border bg-card px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent-coral";
  const labelClass = "block text-xs font-medium text-muted-foreground mb-1";
  const saveClass = buttonClasses("primary", "md", "self-start");

  return (
    <div className="flex flex-col gap-8 max-w-2xl mx-auto">
      <h1 className="font-heading text-3xl font-bold text-dark-blue">Settings</h1>

      {error && (
        <p className="text-sm text-red-600 bg-red-50 rounded-lg px-4 py-3">{error}</p>
      )}

      <section className="bg-card border border-border rounded-2xl p-5">
        <h2 className="font-heading font-semibold text-dark-blue mb-4">Profile</h2>
        <Form method="post" className="flex flex-col gap-4">
          <input type="hidden" name="intent" value="profile" />
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>First name</label>
              <input name="firstName" required defaultValue={me.firstName} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Last name</label>
              <input name="lastName" required defaultValue={me.lastName} className={inputClass} />
            </div>
          </div>
          <div>
            <label className={labelClass}>Role</label>
            <input name="displayRole" defaultValue={me.displayRole ?? ""} className={inputClass} />
          </div>
          <button type="submit" disabled={submitting} className={saveClass}>
            Save profile
          </button>
        </Form>
      </section>

      <section className="bg-card border border-border rounded-2xl p-5">
        <h2 className="font-heading font-semibold text-dark-blue mb-4">
          Organization
        </h2>
        <Form method="post" className="flex flex-col gap-4">
          <input type="hidden" name="intent" value="org" />
          <div>
            <label className={labelClass}>Name</label>
            <input name="name" required defaultValue={org.name} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Website</label>
            <input name="website" defaultValue={org.website ?? ""} className={inputClass} />
          </div>
          <PhotoUploadField
            userId={me.userId}
            name={org.name}
            label="Logo"
            fieldName="logoUrl"
            keyPrefix={`logos/${org.id}`}
            initialKey={org.logoUrl}
            initialPreviewUrl={logoPreviewUrl}
            readOnly={false}
          />
          <button type="submit" disabled={submitting} className={saveClass}>
            Save organization
          </button>
        </Form>
      </section>

      <section className="bg-card border border-border rounded-2xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-heading font-semibold text-dark-blue">Team</h2>
          <button
            type="button"
            onClick={() => setInviting((v) => !v)}
            className="text-sm font-medium text-accent-coral hover:underline"
          >
            + Invite teammate
          </button>
        </div>

        {invited && (
          <p className="text-sm text-accent-teal bg-accent-teal/10 rounded-lg px-4 py-3 mb-3">
            Invitation sent.
          </p>
        )}

        {inviting && (
          <Form
            method="post"
            className="flex flex-wrap items-end gap-3 bg-muted/20 rounded-xl p-4 mb-4"
          >
            <input type="hidden" name="intent" value="invite" />
            <div className="flex-1 min-w-[200px]">
              <label className={labelClass}>Email</label>
              <input name="email" type="email" required className={inputClass} />
            </div>
            <div className="flex-1 min-w-[140px]">
              <label className={labelClass}>Role (optional)</label>
              <input name="displayRole" className={inputClass} />
            </div>
            <button type="submit" disabled={submitting} className={saveClass}>
              Send invite
            </button>
          </Form>
        )}

        <ul className="divide-y divide-border">
          {members.map((m) => {
            const name =
              [m.user.firstName, m.user.lastName].filter(Boolean).join(" ") ||
              m.user.personalEmail ||
              "Unnamed";
            return (
              <li key={m.id} className="py-3 flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <span className="text-sm font-medium text-foreground">{name}</span>
                  {org.primaryContactId === m.id && (
                    <span className="ml-2 text-xs rounded-full bg-accent-teal/15 text-accent-teal px-2 py-0.5">
                      Primary contact
                    </span>
                  )}
                  <div className="text-xs text-muted-foreground">
                    {m.user.personalEmail ?? ""}
                    {m.displayRole ? ` · ${m.displayRole}` : ""}
                  </div>
                </div>
                {org.primaryContactId !== m.id && (
                  <Form method="post">
                    <input type="hidden" name="intent" value="set-primary" />
                    <input type="hidden" name="partnerUserId" value={m.id} />
                    <button
                      type="submit"
                      className="text-xs text-muted-foreground hover:text-foreground transition"
                    >
                      Make primary contact
                    </button>
                  </Form>
                )}
                {org.primaryContactId !== m.id && m.id !== me.partnerUserId && (
                  <Form
                    method="post"
                    onSubmit={confirmSubmit({
                      title: `Remove ${name} from ${org.name}?`,
                      description: "They'll lose access to the portal.",
                      confirmLabel: "Remove",
                      tone: "destructive",
                    })}
                  >
                    <input type="hidden" name="intent" value="remove-member" />
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
            );
          })}
          {pendingInvites.map((inv) => (
            <li key={inv.id} className="py-3 flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <span className="text-sm text-foreground">{inv.email}</span>
                <span className="ml-2 text-xs rounded-full bg-muted text-muted-foreground px-2 py-0.5">
                  Invited
                </span>
                <div className="text-xs text-muted-foreground">
                  Expires {new Date(inv.expiresAt).toLocaleDateString()}
                </div>
              </div>
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
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
