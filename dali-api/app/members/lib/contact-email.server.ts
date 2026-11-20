import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import { prisma } from "~/lib/db.server";
import { BadRequestError } from "~/lib/http-error";
import { logAuditEvent } from "~/lib/audit";
import { getAppEnv } from "~/lib/app-env";
import { enqueueOutbound, drainNow } from "~/lib/outbound.server";
import { freshKey } from "~/lib/outbound-keys.server";
import { otpEmail } from "~/email/lib/auth-email";
import { renderAuthEmail } from "~/email/lib/layout.server";
import { synthesizedAddress } from "~/lib/signin-readiness";
import { normalizeEmailAddress, recordUserEmail } from "~/lib/user-email.server";

export const CONTACT_CODE_TTL_MS = 10 * 60_000;
export const CONTACT_CODE_MAX_ATTEMPTS = 5;
export const CONTACT_CODE_RESEND_MS = 60_000;
export const CONTACT_CODE_MAX_PER_DAY = 10;

export const ADDRESS_ON_OTHER_ACCOUNT =
  "That email is on another DALI OS account. Ask DALI staff to merge them.";

export type ContactEmailOption = { address: string; proven: boolean; current: boolean };

export type ContactEmailOptions = {
  options: ContactEmailOption[];
  preselected: string | null;
};

export type ChooseResult = { status: "unchanged" | "switched" | "code_sent" };

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function identifierFor(userId: string, address: string): string {
  return `contact-email:${userId}:${address}`;
}

function hashCode(identifier: string, code: string): string {
  return createHash("sha256").update(`${identifier}:${code}`).digest("hex");
}

function sameHash(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function listContactEmailOptions(userId: string): Promise<ContactEmailOptions> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      netId: true,
      email: true,
      personalEmail: true,
      daliEmail: true,
      dartmouthEmail: true,
      emails: { select: { address: true, verifiedAt: true }, orderBy: { createdAt: "asc" } },
    },
  });
  if (!user) return { options: [], preselected: null };

  const synthesized = synthesizedAddress(user.netId);
  const current = user.email ? normalizeEmailAddress(user.email) : null;
  const verifiedAt = new Map<string, Date | null>();
  for (const row of user.emails) verifiedAt.set(normalizeEmailAddress(row.address), row.verifiedAt);

  const ordered = [
    user.email,
    user.personalEmail,
    user.daliEmail,
    user.dartmouthEmail,
    ...user.emails.map((row) => row.address),
  ]
    .map((a) => (a ? normalizeEmailAddress(a) : ""))
    .filter((a) => a !== "" && a !== synthesized);

  const options = [...new Set(ordered)].map((address) => ({
    address,
    proven: Boolean(verifiedAt.get(address)),
    current: address === current,
  }));

  const newestProven = options
    .filter((o) => o.proven)
    .sort((a, b) => verifiedAt.get(b.address)!.getTime() - verifiedAt.get(a.address)!.getTime())[0];
  return { options, preselected: newestProven?.address ?? options.find((o) => o.current)?.address ?? null };
}

async function assertNotOnAnotherAccount(userId: string, address: string): Promise<void> {
  const [alias, column] = await Promise.all([
    prisma.userEmail.findUnique({ where: { address }, select: { userId: true } }),
    prisma.user.findFirst({
      where: {
        id: { not: userId },
        OR: [
          { email: { equals: address, mode: "insensitive" } },
          { daliEmail: { equals: address, mode: "insensitive" } },
          { dartmouthEmail: { equals: address, mode: "insensitive" } },
          { personalEmail: { equals: address, mode: "insensitive" } },
        ],
      },
      select: { id: true },
    }),
  ]);
  if ((alias && alias.userId !== userId) || column) throw new BadRequestError(ADDRESS_ON_OTHER_ACCOUNT);
}

function parseAddress(raw: string): string {
  const address = normalizeEmailAddress(raw);
  if (address.length > 254 || !EMAIL_SHAPE.test(address)) {
    throw new BadRequestError("Enter a valid email address.");
  }
  return address;
}

async function switchTo(userId: string, address: string, request?: Request): Promise<void> {
  await assertNotOnAnotherAccount(userId, address);
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  if (!user) throw new BadRequestError("Sign in again to continue.");

  const recorded = await recordUserEmail({ userId, address, verified: true });
  if (!recorded.ok) throw new BadRequestError(ADDRESS_ON_OTHER_ACCOUNT);
  if (user.email && normalizeEmailAddress(user.email) !== address) {
    await recordUserEmail({ userId, address: user.email });
  }
  await prisma.user.update({ where: { id: userId }, data: { email: address, emailVerified: true } });
  await logAuditEvent({ action: "account.contact_email.change", userId, request });
}

async function sendCode(userId: string, address: string): Promise<void> {
  const now = Date.now();
  const [latest, sentToday] = await Promise.all([
    prisma.verification.findFirst({
      where: { identifier: { startsWith: `contact-email:${userId}:` } },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
    prisma.auditLog.count({
      where: {
        action: "account.contact_email.code",
        userId,
        createdAt: { gte: new Date(now - 24 * 60 * 60_000) },
      },
    }),
  ]);
  if (latest && now - latest.createdAt.getTime() < CONTACT_CODE_RESEND_MS) {
    throw new BadRequestError("Wait a minute before asking for another code.");
  }
  if (sentToday >= CONTACT_CODE_MAX_PER_DAY) {
    throw new BadRequestError("Too many codes today. Try again tomorrow.");
  }

  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const identifier = identifierFor(userId, address);
  await prisma.verification.deleteMany({ where: { identifier: { startsWith: `contact-email:${userId}:` } } });
  await prisma.verification.create({
    data: {
      identifier,
      value: `${hashCode(identifier, code)}:0`,
      expiresAt: new Date(now + CONTACT_CODE_TTL_MS),
    },
  });
  await logAuditEvent({ action: "account.contact_email.code", userId });

  if (getAppEnv() === "dev") console.info(`[contact-email:dev] ${code}`);
  const mail = renderAuthEmail(otpEmail({ otp: code, purpose: "change-email" }));
  const { id } = await enqueueOutbound({
    channel: "email",
    purpose: "General",
    dedupKey: freshKey("account.contact_email_code", userId),
    target: address,
    recipientUserId: userId,
    subject: mail.subject,
    bodyHtml: mail.html,
    bodyText: mail.text,
    eventType: "account.contact_email_code",
  });
  await drainNow([id]);
}

export async function chooseContactEmail(args: {
  userId: string;
  address: string;
  request?: Request;
}): Promise<ChooseResult> {
  const address = parseAddress(args.address);
  const user = await prisma.user.findUnique({
    where: { id: args.userId },
    select: { email: true, emails: { where: { address }, select: { verifiedAt: true } } },
  });
  if (!user) throw new BadRequestError("Sign in again to continue.");
  if (user.email && normalizeEmailAddress(user.email) === address) return { status: "unchanged" };

  await assertNotOnAnotherAccount(args.userId, address);

  if (user.emails[0]?.verifiedAt) {
    await switchTo(args.userId, address, args.request);
    return { status: "switched" };
  }
  await sendCode(args.userId, address);
  return { status: "code_sent" };
}

export async function confirmContactEmail(args: {
  userId: string;
  address: string;
  code: string;
  request?: Request;
}): Promise<void> {
  const address = parseAddress(args.address);
  const code = args.code.trim();
  const identifier = identifierFor(args.userId, address);
  const row = await prisma.verification.findFirst({
    where: { identifier },
    orderBy: { createdAt: "desc" },
  });
  const fresh = "Request a new code and try again.";
  if (!row) throw new BadRequestError(`That code didn't work. ${fresh}`);
  if (row.expiresAt <= new Date()) {
    await prisma.verification.deleteMany({ where: { identifier } });
    throw new BadRequestError(`That code expired. ${fresh}`);
  }

  const sep = row.value.lastIndexOf(":");
  const stored = row.value.slice(0, sep);
  const attempts = Number(row.value.slice(sep + 1));
  if (attempts >= CONTACT_CODE_MAX_ATTEMPTS) {
    await prisma.verification.deleteMany({ where: { identifier } });
    throw new BadRequestError(`Too many tries. ${fresh}`);
  }

  const attempt = await prisma.verification.updateMany({
    where: { id: row.id, value: row.value },
    data: { value: `${stored}:${attempts + 1}` },
  });
  if (attempt.count !== 1) throw new BadRequestError("That code didn't match. Check it and try again.");

  if (!sameHash(stored, hashCode(identifier, code))) {
    if (attempts + 1 >= CONTACT_CODE_MAX_ATTEMPTS) {
      await prisma.verification.deleteMany({ where: { identifier } });
      throw new BadRequestError(`Too many tries. ${fresh}`);
    }
    throw new BadRequestError("That code didn't match. Check it and try again.");
  }

  const claimed = await prisma.verification.deleteMany({ where: { id: row.id } });
  if (claimed.count !== 1) throw new BadRequestError(`That code didn't work. ${fresh}`);
  await switchTo(args.userId, address, args.request);
}

export async function adoptInviteAddress(userId: string, address: string, request?: Request): Promise<void> {
  const normalized = normalizeEmailAddress(address);
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  if (!user) return;
  const current = user.email ? normalizeEmailAddress(user.email) : null;
  const currentProven =
    current !== null &&
    current !== normalized &&
    (await prisma.userEmail.findFirst({
      where: { userId, address: current, verifiedAt: { not: null } },
      select: { id: true },
    })) !== null;
  if (currentProven || current === normalized) {
    await recordUserEmail({ userId, address: normalized, verified: true });
    return;
  }
  try {
    await switchTo(userId, normalized, request);
  } catch (err) {
    if (!(err instanceof BadRequestError)) throw err;
  }
}

export type ContactEmailReply =
  | { ok: true; status: "unchanged" | "switched" }
  | { ok: true; status: "code_sent"; address: string }
  | { error: string };

export const CONTACT_EMAIL_INTENTS = ["choose-contact-email", "confirm-contact-email"] as const;

export async function runContactEmailIntent(
  intent: string,
  form: FormData,
  userId: string,
  request?: Request,
): Promise<ContactEmailReply | null> {
  if (!(CONTACT_EMAIL_INTENTS as readonly string[]).includes(intent)) return null;
  const address = String(form.get("address") ?? "");
  try {
    if (intent === "choose-contact-email") {
      const result = await chooseContactEmail({ userId, address, request });
      return result.status === "code_sent"
        ? { ok: true, status: "code_sent", address: normalizeEmailAddress(address) }
        : { ok: true, status: result.status };
    }
    await confirmContactEmail({ userId, address, code: String(form.get("code") ?? ""), request });
    return { ok: true, status: "switched" };
  } catch (e) {
    if (e instanceof BadRequestError) return { error: e.message };
    throw e;
  }
}
