import { createHash, randomBytes } from "node:crypto";
import { prisma } from "~/lib/db";
import { checkRateLimit } from "~/lib/rate-limit";
import { sendMemberEmailConflictEmail } from "./partner-emails.server";

// sha256(raw), base64url, the same digest Session ids use. Partner invites store
// tokens this way; the raw value only ever travels in the email link.
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

// Send a BetterAuth sign-in link to `email`. Always resolves to a "check your
// email" outcome for the caller (unless rate-limited): member-conflict
// addresses get a use-/login email instead, so the response never reveals
// whether an account exists.
export async function issuePartnerMagicLink(
  emailRaw: string,
  request: Request,
): Promise<{ ok: true } | { rateLimited: Response }> {
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
    await sendMemberEmailConflictEmail(email);
    return { ok: true };
  }

  // Lazy: many modules import this file only for normalizeEmail.
  const { auth } = await import("~/lib/betterauth.server");
  try {
    // First-time partners finish setup at /welcome.
    await auth.api.signInMagicLink({
      body: { email, callbackURL: "/welcome?door=partner" },
      headers: request.headers,
    });
  } catch {
    // Neutral outcome either way: the response must not reveal whether the
    // address has an account.
  }
  return { ok: true };
}
