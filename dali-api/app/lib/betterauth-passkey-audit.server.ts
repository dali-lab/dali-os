import { APIError, getSessionFromCtx } from "better-auth/api";
import { logAuditEvent } from "~/lib/audit";
import type { AuditAction } from "~/lib/audit-actions";

// BetterAuth owns the passkey add/delete endpoints (see the passkey plugin in
// betterauth.server.ts), so there is no route of ours to hang audit logging off.
// This after-hook is the one server-side place that observes every enrollment
// and removal, no matter which surface triggered it — Settings → Devices, the
// in-app PasskeyEnrollmentPrompt, or the /welcome offer all funnel through the
// same endpoints. Logging here rather than at each client call site keeps the
// trail complete and non-spoofable (a client can't skip or forge it).

const PATH_TO_ACTION: Record<string, AuditAction> = {
  // Persists the credential after the WebAuthn ceremony completes.
  "/passkey/verify-registration": "auth.passkey.register",
  "/passkey/delete-passkey": "auth.passkey.remove",
};

// The audit action for a BetterAuth endpoint path, or null when it isn't an
// audited passkey mutation. Split out so the mapping is unit-testable.
export function passkeyAuditAction(path: string | undefined): AuditAction | null {
  return path ? (PATH_TO_ACTION[path] ?? null) : null;
}

// `ctx` is BetterAuth's endpoint hook context. Typed loosely on purpose: the
// plugin's context generics aren't exported, and this adapter only reads a few
// stable fields (path, the endpoint's returned value, the session, the request).
export async function auditPasskeyMutation(ctx: any): Promise<void> {
  const action = passkeyAuditAction(ctx?.path);
  if (!action) return;

  // Audit must never break the auth flow — an audit failure can't be allowed to
  // fail the passkey ceremony's response, so the whole body is guarded.
  try {
    // Only log successful mutations. A failed ceremony or an unauthorized delete
    // surfaces as an APIError in the endpoint's `returned` value.
    if (ctx.context?.returned instanceof APIError) return;

    const session = ctx.context?.session ?? (await getSessionFromCtx(ctx));
    const returned = ctx.context?.returned;
    const userId: string | null =
      session?.user?.id ??
      // Registration returns the created passkey, which carries userId — a
      // fallback for the case where the hook context hasn't cached a session.
      (typeof returned?.userId === "string" ? returned.userId : null);
    if (!userId) return;

    await logAuditEvent({
      action,
      userId,
      metadata: { via: "betterauth" },
      request: ctx.request,
    });
  } catch (err) {
    console.error(
      "passkey audit hook failed",
      err instanceof Error ? err.message : String(err),
    );
  }
}
