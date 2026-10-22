import { APIError } from "better-auth/api";
import { logAuditEvent } from "~/lib/audit";

// BetterAuth owns every sign-in endpoint (/api/auth/* is a catch-all), so no
// route of ours sees a login. These helpers hang off BetterAuth's hooks, the one
// place that observes sign-ins from every surface (web, desktop, MCP).

const SIGN_IN_METHODS: Record<string, string> = {
  "/sign-in/email-otp": "email-otp",
  "/magic-link/verify": "magic-link",
  "/passkey/verify-authentication": "passkey",
  "/callback/:id": "social",
  "/oauth2/callback/:providerId": "social",
};

// Endpoints whose APIError return is a failed sign-in. Social callbacks fail by
// redirect, not by error, so they only appear in the success mapping.
const FAILURE_PATHS = new Set([
  "/sign-in/email-otp",
  "/magic-link/verify",
  "/passkey/verify-authentication",
]);

export function signInMethod(path: string | undefined): string | null {
  return path ? (SIGN_IN_METHODS[path] ?? null) : null;
}

type SessionLike = {
  userId?: string;
  impersonatedBy?: string | null;
  grantId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
};

export async function auditSessionCreated(
  session: SessionLike,
  ctx: any,
): Promise<void> {
  try {
    if (!session?.userId || session.impersonatedBy || session.grantId) return;
    // No endpoint path means mintBetterAuthSession (pairing, handoff, legacy
    // cookie upgrade); those callers write their own pairing.* rows.
    if (!ctx?.path) return;
    await logAuditEvent({
      action: "login.success",
      userId: session.userId,
      metadata: {
        via: "betterauth",
        method: signInMethod(ctx?.path) ?? "unknown",
      },
      request: ctx?.request,
      ip: ctx?.request ? undefined : session.ipAddress,
      userAgent: ctx?.request ? undefined : session.userAgent,
    });
  } catch (err) {
    console.error(
      "session audit hook failed",
      err instanceof Error ? err.message : String(err),
    );
  }
}

export async function auditSignInFailure(ctx: any): Promise<void> {
  try {
    const method = signInMethod(ctx?.path);
    const returned = ctx?.context?.returned;
    if (!method || !FAILURE_PATHS.has(ctx.path)) return;
    if (!(returned instanceof APIError)) return;

    const email = ctx.body?.email;
    await logAuditEvent({
      action: "login.failure",
      metadata: {
        via: "betterauth",
        method,
        code: returned.body?.code ?? String(returned.status),
        ...(typeof email === "string" ? { email: email.toLowerCase() } : {}),
      },
      request: ctx.request,
    });
  } catch (err) {
    console.error(
      "sign-in failure audit hook failed",
      err instanceof Error ? err.message : String(err),
    );
  }
}

export async function auditAccountCreated(
  user: { id: string; email?: unknown },
  ctx: any,
): Promise<void> {
  await logAuditEvent({
    action: "account.create",
    userId: user.id,
    targetId: user.id,
    metadata: {
      via: "betterauth",
      ...(typeof user.email === "string" ? { email: user.email.toLowerCase() } : {}),
    },
    request: ctx?.request,
  });
}
