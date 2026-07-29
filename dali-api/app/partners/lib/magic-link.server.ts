import { createHash, randomBytes } from "node:crypto";
import { prisma } from "~/lib/db";
import { logAuditEvent } from "~/lib/audit";
import { checkRateLimit } from "~/lib/rate-limit";
import { getFrontendUrl } from "~/lib/app-env";
import {
  sendPartnerMagicLinkEmail,
  sendMemberEmailConflictEmail,
} from "./partner-emails.server";

export const MAGIC_LINK_TTL_MS = 15 * 60 * 1000;

// Same digest convention as Session ids and OneTimeToken's schema comment:
// sha256(raw), base64url. The raw value only ever travels in the email link.
export function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("base64url");
}

export function generateRawToken(): string {
  return randomBytes(32).toString("base64url");
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export type EmailIdentity =
  | { kind: "member-conflict" }
  | { kind: "existing"; userId: string }
  | { kind: "new" };

// Who does this email belong to, for partner-auth purposes? An address is a
// member conflict when it's a @dali.dartmouth.edu address, or it matches a
// User carrying member/Dartmouth identity (daliEmail, netId, dartmouthEmail,
// or a DALIMember row). Those accounts must keep signing in through /login —
// a partner account is never attached to them.
export async function classifyPartnerEmail(
  email: string,
): Promise<EmailIdentity> {
  if (email.endsWith("@dali.dartmouth.edu")) return { kind: "member-conflict" };
  const user = await prisma.user.findFirst({
    where: {
      OR: [
        { daliEmail: email },
        { dartmouthEmail: email },
        { personalEmail: email },
      ],
    },
    select: { id: true, daliEmail: true, dartmouthEmail: true, netId: true },
  });
  if (!user) return { kind: "new" };
  if (user.daliEmail || user.dartmouthEmail || user.netId) {
    return { kind: "member-conflict" };
  }
  const member = await prisma.dALIMember.findUnique({
    where: { userId: user.id },
    select: { id: true },
  });
  if (member) return { kind: "member-conflict" };
  return { kind: "existing", userId: user.id };
}

// Issue a sign-in link for `email`. Always resolves to a "check your email"
// outcome for the caller (unless rate-limited) — member-conflict addresses
// get a redirect-to-/login email instead of a token, so the UI response
// never reveals whether an account exists.
export async function issuePartnerMagicLink(
  emailRaw: string,
  request: Request,
): Promise<{ ok: true } | { rateLimited: Response } | { sendFailed: true }> {
  const email = normalizeEmail(emailRaw);

  const ipLimited = checkRateLimit(request, { max: 5, windowMs: 10 * 60_000 });
  if (ipLimited) return { rateLimited: ipLimited };
  const emailLimited = checkRateLimit(
    request,
    { max: 3, windowMs: 15 * 60_000 },
    `partner-magic-link:${email}`,
  );
  if (emailLimited) return { rateLimited: emailLimited };

  const identity = await classifyPartnerEmail(email);
  if (identity.kind === "member-conflict") {
    const res = await sendMemberEmailConflictEmail(email);
    return res.ok ? { ok: true } : { sendFailed: true };
  }

  // OneTimeToken.userId is NOT NULL, so a first-time email eagerly creates
  // the User row. Names are collected at onboarding. Junk rows are inert —
  // without a PartnerUser row they grant no access.
  const userId =
    identity.kind === "existing"
      ? identity.userId
      : (
          await prisma.user.create({
            data: { personalEmail: email, firstName: "", lastName: "" },
            select: { id: true },
          })
        ).id;

  // One live link per user: requesting a new one invalidates the old.
  await prisma.oneTimeToken.updateMany({
    where: { userId, purpose: "PartnerMagicLink", usedAt: null },
    data: { usedAt: new Date() },
  });

  const raw = generateRawToken();
  await prisma.oneTimeToken.create({
    data: {
      userId,
      tokenHash: hashToken(raw),
      purpose: "PartnerMagicLink",
      expiresAt: new Date(Date.now() + MAGIC_LINK_TTL_MS),
      metadata: { email },
    },
  });

  const url = `${getFrontendUrl()}/partner/auth/verify?token=${raw}`;
  const sendRes = await sendPartnerMagicLinkEmail(email, url);
  await logAuditEvent({
    action: "partner.magic_link.requested",
    userId,
    request,
  });
  if (!sendRes.ok) return { sendFailed: true };

  return { ok: true };
}

// Read-only validity check for the GET landing page. Never consumes — email
// security scanners prefetch GET links and would burn single-use tokens.
export async function peekPartnerMagicLink(raw: string): Promise<boolean> {
  const token = await prisma.oneTimeToken.findFirst({
    where: {
      tokenHash: hashToken(raw),
      purpose: "PartnerMagicLink",
      usedAt: null,
      expiresAt: { gt: new Date() },
    },
    select: { id: true },
  });
  return token !== null;
}

// Atomic single-use consumption: the updateMany's where-guard means two
// concurrent POSTs can't both win (the loser matches 0 rows).
export async function consumePartnerMagicLink(
  raw: string,
): Promise<string | null> {
  const tokenHash = hashToken(raw);
  const res = await prisma.oneTimeToken.updateMany({
    where: {
      tokenHash,
      purpose: "PartnerMagicLink",
      usedAt: null,
      expiresAt: { gt: new Date() },
    },
    data: { usedAt: new Date() },
  });
  if (res.count !== 1) return null;
  const token = await prisma.oneTimeToken.findUnique({
    where: { tokenHash },
    select: { userId: true },
  });
  return token?.userId ?? null;
}
