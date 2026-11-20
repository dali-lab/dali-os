import { createHash, randomBytes } from "node:crypto";
import { prisma } from "~/lib/db.server";
import { getApiBaseUrl } from "~/lib/app-env";
import { enqueueOutbound, drainNow } from "~/lib/outbound.server";
import { alumniInviteFreshKey, alumniInviteLaunchKey } from "~/lib/outbound-keys.server";
import { ALUMNI_INVITE_TTL_SECONDS, alumniInviteEmail } from "~/email/lib/auth-email";
import { renderAuthEmail, renderFramedEmail } from "~/email/lib/layout.server";
import { renderEmailTemplate } from "~/email/lib/templates.server";
import { emailTemplateDef, type EmailTemplateKey } from "~/email/lib/registry";
import { htmlToPlainText } from "~/lib/email";
import { normalizeEmailAddress } from "~/lib/user-email.server";

export const ALUMNI_INVITE_TTL_MS = ALUMNI_INVITE_TTL_SECONDS * 1000;
export const FRESH_LINK_COOLDOWN_MS = 10 * 60_000;

export type InviteStatus = "valid" | "expired" | "used" | "unknown";

export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function alumniInviteUrl(token: string): string {
  return `${getApiBaseUrl()}/alumni/invite/${token}`;
}

export async function createAlumniInvite(args: {
  userId: string;
  sentTo: string;
  batch?: string | null;
  ttlMs?: number;
}): Promise<{ id: string; token: string; url: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + (args.ttlMs ?? ALUMNI_INVITE_TTL_MS));
  const row = await prisma.alumniInvite.create({
    data: {
      userId: args.userId,
      tokenHash: hashInviteToken(token),
      sentTo: normalizeEmailAddress(args.sentTo),
      batch: args.batch ?? null,
      expiresAt,
    },
    select: { id: true },
  });
  return { id: row.id, token, url: alumniInviteUrl(token), expiresAt };
}

export async function lookupAlumniInvite(
  token: string,
): Promise<{ status: InviteStatus; userId?: string; firstName?: string }> {
  const row = await prisma.alumniInvite.findUnique({
    where: { tokenHash: hashInviteToken(token) },
    select: { userId: true, usedAt: true, expiresAt: true, user: { select: { firstName: true } } },
  });
  if (!row) return { status: "unknown" };
  const base = { userId: row.userId, firstName: row.user.firstName };
  if (row.usedAt) return { status: "used", ...base };
  if (row.expiresAt <= new Date()) return { status: "expired", ...base };
  return { status: "valid", ...base };
}

export type RedeemResult = { ok: true; userId: string; sentTo: string } | { ok: false };

export async function redeemAlumniInvite(token: string): Promise<RedeemResult> {
  const tokenHash = hashInviteToken(token);
  const now = new Date();
  const claim = await prisma.alumniInvite.updateMany({
    where: { tokenHash, usedAt: null, expiresAt: { gt: now } },
    data: { usedAt: now },
  });
  if (claim.count !== 1) return { ok: false };
  const row = await prisma.alumniInvite.findUnique({
    where: { tokenHash },
    select: { userId: true, sentTo: true },
  });
  return row ? { ok: true, userId: row.userId, sentTo: row.sentTo } : { ok: false };
}

export async function sendFreshAlumniInvite(token: string): Promise<void> {
  const row = await prisma.alumniInvite.findUnique({
    where: { tokenHash: hashInviteToken(token) },
    select: { userId: true, sentTo: true, batch: true, usedAt: true, expiresAt: true },
  });
  if (!row) return;
  if (!row.usedAt && row.expiresAt > new Date()) return;

  const recent = await prisma.alumniInvite.findFirst({
    where: { userId: row.userId, createdAt: { gt: new Date(Date.now() - FRESH_LINK_COOLDOWN_MS) } },
    select: { id: true },
  });
  if (recent) return;

  const invite = await createAlumniInvite({ userId: row.userId, sentTo: row.sentTo, batch: row.batch });
  const mail = renderAuthEmail(alumniInviteEmail({ url: invite.url }));
  const { id } = await enqueueOutbound({
    channel: "email",
    purpose: "General",
    dedupKey: alumniInviteFreshKey(invite.id),
    target: row.sentTo,
    recipientUserId: row.userId,
    subject: mail.subject,
    bodyHtml: mail.html,
    bodyText: mail.text,
    eventType: "alumni.invite.fresh",
  });
  await drainNow([id]);
}

export const LAUNCH_TEMPLATE_KEY = "alumni.invite" as const;

export async function sendLaunchInvite(args: {
  userId: string;
  firstName: string;
  address: string;
  batch: string;
  templateKey?: EmailTemplateKey;
}): Promise<{ queued: boolean }> {
  const key = args.templateKey ?? LAUNCH_TEMPLATE_KEY;
  const invite = await createAlumniInvite({ userId: args.userId, sentTo: args.address, batch: args.batch });
  try {
    const rendered = await renderEmailTemplate(key, { firstName: args.firstName, inviteLink: invite.url });
    if (!rendered) {
      await prisma.alumniInvite.deleteMany({ where: { id: invite.id } });
      return { queued: false };
    }
    const mail = renderFramedEmail(
      {
        subject: rendered.subject,
        preheader: rendered.subject,
        bodyHtml: rendered.html,
        text: htmlToPlainText(rendered.html),
      },
      { footer: emailTemplateDef(key).footer },
    );
    const { deduped } = await enqueueOutbound({
      channel: "email",
      purpose: emailTemplateDef(key).purpose,
      dedupKey: alumniInviteLaunchKey(args.batch, args.userId),
      target: normalizeEmailAddress(args.address),
      recipientUserId: args.userId,
      subject: mail.subject,
      bodyHtml: mail.html,
      bodyText: mail.text,
      eventType: "alumni.invite.launch",
    });
    return { queued: !deduped };
  } catch (err) {
    await prisma.alumniInvite.deleteMany({ where: { id: invite.id } });
    throw err;
  }
}
