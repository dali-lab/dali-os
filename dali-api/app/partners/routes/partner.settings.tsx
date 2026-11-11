import { useEffect, useState, type ReactNode } from "react";
import { useFetcher, useLoaderData } from "react-router";
import { MoreHorizontal } from "lucide-react";
import type { Route } from "./+types/partner.settings";
import { prisma } from "~/lib/db.server";
import { logAuditEvent } from "~/lib/audit";
import { resolvePhotoUrl } from "~/lib/photo";
import { isValidTimezone } from "~/lib/timezone";
import { PhotoUploadField } from "~/components/PhotoUploadField";
import { AppearanceSettingsBlock } from "~/components/settings/AppearanceSettingsBlock";
import { PasskeysSettingsBlock } from "~/components/settings/PasskeysSettingsBlock";
import { TimeZoneField } from "~/components/settings/TimeZoneField";
import { useOsChrome } from "~/components/os-chrome";
import { Button } from "~/components/ui/Button";
import { IconButton } from "~/components/ui/IconButton";
import { FormField } from "~/components/ui/FormField";
import { Toggle } from "~/components/ui/Toggle";
import { useDialog } from "~/components/ui/dialog";
import { useToast } from "~/components/ui/toast";
import { InfoTip, Menu } from "~/components/ui/floating";
import { saveNotificationSettings } from "~/lib/notification-settings.server";
import { EVENT_TYPES, defaultEmailFor } from "~/lib/notification-events";
import {
  requirePartnerAccount,
  type PartnerAccountContext,
} from "~/partners/lib/partner-auth.server";
import {
  createPartnerInvite,
  listPendingInvites,
  revokePartnerInvite,
} from "~/partners/lib/invites.server";

export const meta: Route.MetaFunction = () => [{ title: "Settings · DALI OS" }];

type ActionResult = { ok: true; intent: string } | { ok: false; error: string };

const REPLY_EVENT = "collab.comment_reply";

export async function loader({ request }: Route.LoaderArgs) {
  const ctx = await requirePartnerAccount(request);
  const [user, replyPref] = await Promise.all([
    prisma.user.findUnique({
      where: { id: ctx.auth.user.sub },
      select: { firstName: true, lastName: true, photoUrl: true, pronouns: true, timeZone: true },
    }),
    prisma.notificationPreference.findUnique({
      where: { userId_eventType: { userId: ctx.auth.user.sub, eventType: REPLY_EVENT } },
      select: { inApp: true, digestFrequency: true },
    }),
  ]);
  const [contactFirst = "", ...contactRest] = ctx.contact.name.split(" ");
  const dateZone = user?.timeZone ?? "America/New_York";

  const orgs = await Promise.all(
    ctx.memberships
      .filter((m) => !m.org.isIndividual)
      .map(async (m) => {
        const [members, invites, logoPreviewUrl] = await Promise.all([
          prisma.partnerMembership.findMany({
            where: { orgId: m.orgId, endedAt: null },
            orderBy: { createdAt: "asc" },
            select: { id: true, role: true, contact: { select: { name: true, email: true } } },
          }),
          listPendingInvites(m.orgId),
          resolvePhotoUrl(m.org.logoUrl),
        ]);
        return {
          id: m.org.id,
          name: m.org.name,
          website: m.org.website,
          logoUrl: m.org.logoUrl,
          logoPreviewUrl,
          primaryContactId: m.org.primaryContactId,
          myMembershipId: m.id,
          myRole: m.role,
          members,
          pendingInvites: invites.map((inv) => ({
            id: inv.id,
            email: inv.email,
            expires: new Date(inv.expiresAt).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              timeZone: dateZone,
            }),
          })),
        };
      }),
  );

  return {
    me: {
      userId: ctx.auth.user.sub,
      firstName: user?.firstName || contactFirst,
      lastName: user?.firstName ? user.lastName : contactRest.join(" "),
      pronouns: user?.pronouns ?? null,
      timeZone: user?.timeZone ?? null,
      photoUrl: user?.photoUrl ?? null,
    },
    photoPreviewUrl: await resolvePhotoUrl(user?.photoUrl),
    orgs,
    replies: {
      inApp: replyPref?.inApp ?? EVENT_TYPES[REPLY_EVENT].defaults.inApp,
      email: (replyPref?.digestFrequency ?? defaultEmailFor(EVENT_TYPES[REPLY_EVENT], "partner")) !== "Off",
    },
  };
}

function text(form: FormData, key: string): string {
  return ((form.get(key) as string | null) ?? "").trim();
}

function normalizeWebsite(raw: string): { url: string | null } | { error: string } {
  if (!raw) return { url: null };
  const url = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;
  try {
    const parsed = new URL(url);
    if ((parsed.protocol === "https:" || parsed.protocol === "http:") && parsed.hostname.includes(".")) {
      return { url };
    }
  } catch {
    // falls through to the error
  }
  return { error: "Enter a website like example.com." };
}

function teamMembership(ctx: PartnerAccountContext, form: FormData) {
  const orgId = text(form, "orgId");
  return ctx.memberships.find((m) => m.orgId === orgId && !m.org.isIndividual) ?? null;
}

export async function action({ request }: Route.ActionArgs): Promise<ActionResult> {
  const ctx = await requirePartnerAccount(request);
  const form = await request.formData();
  const intent = text(form, "intent");
  const fail = (error: string): ActionResult => ({ ok: false, error });
  const done: ActionResult = { ok: true, intent };

  if (intent === "notifications") {
    const result = await saveNotificationSettings(ctx.auth.user.sub, form, {
      audience: "partner",
      isAdmin: false,
      isCore: false,
    });
    return result.ok ? done : fail(result.error);
  }

  if (intent === "profile") {
    const firstName = text(form, "firstName");
    const lastName = text(form, "lastName");
    if (!firstName) return fail("Enter your name.");
    const timeZone = text(form, "timeZone") || null;
    if (timeZone && !isValidTimezone(timeZone)) return fail("Choose a valid time zone.");
    await prisma.$transaction([
      prisma.user.update({
        where: { id: ctx.auth.user.sub },
        data: {
          firstName,
          lastName,
          pronouns: text(form, "pronouns") || null,
          timeZone,
          photoUrl: text(form, "photoUrl") || null,
        },
      }),
      prisma.partnerContact.update({
        where: { id: ctx.contact.id },
        data: { name: [firstName, lastName].filter(Boolean).join(" ") },
      }),
    ]);
    return done;
  }

  const membership = teamMembership(ctx, form);
  if (!membership) return fail("Organization not found.");
  const org = membership.org;
  const isPrimary = org.primaryContactId === membership.id;

  if (intent === "org") {
    const name = text(form, "name");
    if (!name) return fail("Enter the organization's name.");
    const website = normalizeWebsite(text(form, "website"));
    if ("error" in website) return fail(website.error);
    await prisma.$transaction([
      prisma.partnerOrg.update({
        where: { id: org.id },
        data: { name, website: website.url, logoUrl: text(form, "logoUrl") || null },
      }),
      prisma.partnerMembership.update({
        where: { id: membership.id },
        data: { role: text(form, "role") || null },
      }),
    ]);
    await logAuditEvent({
      action: "partner.org.update",
      userId: ctx.auth.user.sub,
      targetId: org.id,
      metadata: { via: "partner-settings" },
      request,
    });
    return done;
  }

  if (intent === "set-primary" || intent === "remove-member") {
    const target = await prisma.partnerMembership.findFirst({
      where: { id: text(form, "membershipId"), orgId: org.id, endedAt: null },
      select: { id: true },
    });
    if (!target) return fail("Member not found.");

    if (intent === "set-primary") {
      if (org.primaryContactId && !isPrimary) {
        return fail("Only the primary contact can change this.");
      }
      await prisma.partnerOrg.update({
        where: { id: org.id },
        data: { primaryContactId: target.id },
      });
      await logAuditEvent({
        action: "partner.org.update",
        userId: ctx.auth.user.sub,
        targetId: org.id,
        metadata: { change: "primary-contact" },
        request,
      });
      return done;
    }

    if (!isPrimary) return fail("Only the primary contact can remove members.");
    if (target.id === membership.id) return fail("You can't remove yourself.");
    await prisma.partnerMembership.update({
      where: { id: target.id },
      data: { endedAt: new Date() },
    });
    await logAuditEvent({
      action: "partner.member.remove",
      userId: ctx.auth.user.sub,
      targetId: org.id,
      metadata: { membershipId: target.id },
      request,
    });
    return done;
  }

  if (intent === "invite") {
    const result = await createPartnerInvite(
      {
        partnerOrgId: org.id,
        email: text(form, "email"),
        displayRole: text(form, "displayRole") || null,
        invitedByUserId: ctx.auth.user.sub,
      },
      request,
    );
    return "error" in result ? fail(result.error) : done;
  }

  if (intent === "revoke-invite") {
    const result = await revokePartnerInvite(
      { inviteId: text(form, "inviteId"), partnerOrgId: org.id, actorUserId: ctx.auth.user.sub },
      request,
    );
    return "error" in result ? fail(result.error) : done;
  }

  return fail("Unknown action.");
}

type LoaderData = Awaited<ReturnType<typeof loader>>;
type OrgData = LoaderData["orgs"][number];

function useSettingsFetcher(successMessage: string, onSuccess?: () => void) {
  const fetcher = useFetcher<ActionResult>();
  const toast = useToast();
  const data = fetcher.state === "idle" ? fetcher.data : undefined;
  useEffect(() => {
    if (data?.ok) {
      toast.success(successMessage);
      onSuccess?.();
    }
  }, [data]);
  const error = data && !data.ok ? data.error : null;
  return { fetcher, error, busy: fetcher.state !== "idle" };
}

function Section({ title, info, action, children }: { title: string; info?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4 rounded-os-card bg-os-card p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-1.5 font-heading text-[19px] font-semibold text-foreground">
          {title}
          {info && <InfoTip content={info} />}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function FormError({ error }: { error: string | null }) {
  if (!error) return null;
  return <p className="rounded-os-item bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</p>;
}

function ProfileSection({ me, photoPreviewUrl }: Pick<LoaderData, "me" | "photoPreviewUrl">) {
  const { fetcher, error, busy } = useSettingsFetcher("Profile saved");
  const { fieldLabel } = useOsChrome();
  return (
    <Section title="Profile">
      <fetcher.Form method="post" className="os-form flex flex-col gap-4">
        <input type="hidden" name="intent" value="profile" />
        <PhotoUploadField
          userId={me.userId}
          name={`${me.firstName} ${me.lastName}`.trim()}
          initialKey={me.photoUrl}
          initialPreviewUrl={photoPreviewUrl}
          readOnly={false}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="First name" name="firstName" required defaultValue={me.firstName} />
          <FormField label="Last name" name="lastName" defaultValue={me.lastName} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Pronouns" name="pronouns" placeholder="e.g. they/them" defaultValue={me.pronouns ?? ""} />
          <div className={fieldLabel}>
            <span className="flex items-center gap-1.5">
              Time zone
              <InfoTip content="Used when scheduling meetings with the lab." />
            </span>
            <TimeZoneField defaultValue={me.timeZone} />
          </div>
        </div>
        <FormError error={error} />
        <Button type="submit" disabled={busy} className="self-start">
          Save profile
        </Button>
      </fetcher.Form>
    </Section>
  );
}

function OrganizationSection({ org, userId }: { org: OrgData; userId: string }) {
  const { fetcher, error, busy } = useSettingsFetcher("Organization saved");
  return (
    <Section title={org.name}>
      <fetcher.Form method="post" className="os-form flex flex-col gap-4">
        <input type="hidden" name="intent" value="org" />
        <input type="hidden" name="orgId" value={org.id} />
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Organization name" name="name" required defaultValue={org.name} />
          <FormField label="Website" name="website" placeholder="example.com" defaultValue={org.website ?? ""} />
        </div>
        <FormField label="Your role" name="role" placeholder="e.g. Director of Operations" defaultValue={org.myRole ?? ""} />
        <PhotoUploadField
          userId={userId}
          name={org.name}
          label="Logo"
          fieldName="logoUrl"
          keyPrefix={`logos/${org.id}`}
          initialKey={org.logoUrl}
          initialPreviewUrl={org.logoPreviewUrl}
          readOnly={false}
        />
        <FormError error={error} />
        <Button type="submit" disabled={busy} className="self-start">
          Save organization
        </Button>
      </fetcher.Form>
    </Section>
  );
}

function TeamSection({ org }: { org: OrgData }) {
  const [inviting, setInviting] = useState(false);
  const invite = useSettingsFetcher("Invite sent", () => setInviting(false));
  const rowAction = useSettingsFetcher("Team updated");
  const dialog = useDialog();
  const isPrimary = org.primaryContactId === org.myMembershipId;
  const canSetPrimary = isPrimary || !org.primaryContactId;

  function submit(fields: Record<string, string>) {
    rowAction.fetcher.submit({ orgId: org.id, ...fields }, { method: "post" });
  }

  async function makePrimary(membershipId: string, name: string) {
    const ok = await dialog.confirm({
      title: `Make ${name} the primary contact?`,
      description: isPrimary ? "Only the primary contact can remove members." : undefined,
      confirmLabel: "Make primary",
    });
    if (ok) submit({ intent: "set-primary", membershipId });
  }

  async function remove(membershipId: string, name: string) {
    const ok = await dialog.confirm({
      title: `Remove ${name} from ${org.name}?`,
      description: "They'll lose access to the portal.",
      confirmLabel: "Remove",
      tone: "destructive",
    });
    if (ok) submit({ intent: "remove-member", membershipId });
  }

  async function revoke(inviteId: string, email: string) {
    const ok = await dialog.confirm({
      title: `Revoke invite for ${email}?`,
      description: "Their invite link will stop working.",
      confirmLabel: "Revoke",
      tone: "destructive",
    });
    if (ok) submit({ intent: "revoke-invite", inviteId });
  }

  return (
    <Section
      title="Team"
      info="Anyone on the team can edit the organization and invite people. The primary contact manages who is on it."
      action={
        !inviting && (
          <Button variant="secondary" size="sm" onClick={() => setInviting(true)}>
            Invite teammate
          </Button>
        )
      }
    >
      {inviting && (
        <invite.fetcher.Form method="post" className="os-form flex flex-col gap-3 rounded-os-item bg-os-well p-4">
          <input type="hidden" name="intent" value="invite" />
          <input type="hidden" name="orgId" value={org.id} />
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label="Email" name="email" type="email" required />
            <FormField label="Role" name="displayRole" placeholder="Optional" />
          </div>
          <FormError error={invite.error} />
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={invite.busy}>
              Send invite
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setInviting(false)}>
              Cancel
            </Button>
          </div>
        </invite.fetcher.Form>
      )}

      <FormError error={rowAction.error} />

      <ul className="divide-y divide-border">
        {org.members.map((m) => {
          const name = m.contact.name || m.contact.email || "Unnamed";
          const isRowPrimary = org.primaryContactId === m.id;
          const showMakePrimary = canSetPrimary && !isRowPrimary;
          const showRemove = isPrimary && m.id !== org.myMembershipId;
          return (
            <li key={m.id} className="flex items-center gap-3 py-3">
              <div className="min-w-0 flex-1">
                <span className="text-sm font-medium text-foreground">{name}</span>
                {isRowPrimary && (
                  <span className="ml-2 rounded-full bg-os-accent/15 px-2 py-0.5 text-xs text-os-accent">
                    Primary contact
                  </span>
                )}
                <div className="text-xs text-muted-foreground">
                  {m.contact.email ?? ""}
                  {m.role ? ` · ${m.role}` : ""}
                </div>
              </div>
              {(showMakePrimary || showRemove) && (
                <Menu
                  align="right"
                  ariaLabel={`Actions for ${name}`}
                  trigger={<IconButton label="More" icon={MoreHorizontal} disabled={rowAction.busy} />}
                >
                  {showMakePrimary && (
                    <Menu.Item onSelect={() => void makePrimary(m.id, name)}>Make primary contact</Menu.Item>
                  )}
                  {showRemove && (
                    <Menu.Item destructive onSelect={() => void remove(m.id, name)}>
                      Remove
                    </Menu.Item>
                  )}
                </Menu>
              )}
            </li>
          );
        })}
        {org.pendingInvites.map((inv) => (
          <li key={inv.id} className="flex items-center gap-3 py-3">
            <div className="min-w-0 flex-1">
              <span className="text-sm text-foreground">{inv.email}</span>
              <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">Invited</span>
              <div className="text-xs text-muted-foreground">Expires {inv.expires}</div>
            </div>
            <Menu
              align="right"
              ariaLabel={`Actions for ${inv.email}`}
              trigger={<IconButton label="More" icon={MoreHorizontal} disabled={rowAction.busy} />}
            >
              <Menu.Item destructive onSelect={() => void revoke(inv.id, inv.email)}>
                Revoke invite
              </Menu.Item>
            </Menu>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function NotificationsSection({ replies }: Pick<LoaderData, "replies">) {
  const { fetcher, error } = useSettingsFetcher("Notifications saved");
  const [email, setEmail] = useState(replies.email);

  function change(on: boolean) {
    setEmail(on);
    fetcher.submit(
      {
        intent: "notifications",
        [`${REPLY_EVENT}:present`]: "1",
        [`${REPLY_EVENT}:email`]: on ? "Instant" : "Off",
        ...(replies.inApp ? { [`${REPLY_EVENT}:inApp`]: "on" } : {}),
      },
      { method: "post" },
    );
  }

  return (
    <section id="notifications" className="scroll-mt-6">
      <Section title="Notifications">
        <Toggle
          tone="os"
          label="Email me replies to my comments"
          checked={email}
          onChange={(e) => change(e.target.checked)}
        />
        <FormError error={error} />
      </Section>
    </section>
  );
}

export default function PartnerSettings() {
  const { me, photoPreviewUrl, orgs, replies } = useLoaderData<typeof loader>();
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-8">
      <h1 className="font-heading text-4xl font-medium text-foreground">Settings</h1>
      <ProfileSection me={me} photoPreviewUrl={photoPreviewUrl} />
      {orgs.map((org) => (
        <div key={org.id} className="flex flex-col gap-8">
          <OrganizationSection org={org} userId={me.userId} />
          <TeamSection org={org} />
        </div>
      ))}
      <NotificationsSection replies={replies} />
      <Section title="Appearance">
        <AppearanceSettingsBlock />
      </Section>
      <Section title="Passkeys" info="Sign in with Face ID, Touch ID or a security key instead of an email link.">
        <PasskeysSettingsBlock />
      </Section>
    </div>
  );
}
