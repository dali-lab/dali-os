import type { Route } from "./+types/api.passkey-prompt";
import { getBetterAuthUser } from "~/lib/betterauth-compat.server";
import { prisma } from "~/lib/db";
import { isFeatureEnabledForEveryone } from "~/lib/feature-flags.server";
import {
  shouldOfferPasskey,
  setPasskeyPromptDismissed,
} from "~/lib/passkey-prompt.server";
import { logAuditEvent } from "~/lib/audit";

// Backs the in-app passkey enrollment prompt (PasskeyEnrollmentPrompt), which
// reaches users the post-login /welcome offer misses — notably members migrated
// by the silent legacy→BetterAuth session upgrade, who never hit the login flow.
//
// GET  → eligibility ({ offer }). Only when passwordless auth is live, the user
//        has no passkey yet, and they haven't dismissed on this device.
// POST → the user acted: "dismiss" (Not now) or "enrolled" (WebAuthn ceremony
//        completed client-side). Both set the per-device dismissal cookie so we
//        don't nag again; "enrolled" is verified against the Passkey table and
//        recorded in the audit log.

export async function loader({ request }: Route.LoaderArgs) {
  // Require a real BetterAuth session — not just any session. Enrollment
  // (authClient.passkey.addPasskey) hits a BetterAuth endpoint that only accepts
  // a BetterAuth session, so right after the flag flip a user is still on a
  // legacy session (requireAuth would honor it) and offering the prompt then
  // 401s the ceremony. The legacy→BetterAuth session upgrade converts them
  // first; only once they hold a BetterAuth session do we offer.
  const user = await getBetterAuthUser(request);
  if (!user) return { offer: false };
  // Belt-and-suspenders: a BetterAuth session implies the flag is live, but keep
  // the explicit gate so a stale session can't surface the prompt flag-off.
  if (!(await isFeatureEnabledForEveryone("betterauth", request))) {
    return { offer: false };
  }
  return { offer: await shouldOfferPasskey(request, user.sub) };
}

export async function action({ request }: Route.ActionArgs) {
  const user = await getBetterAuthUser(request);
  if (!user) return Response.json({ ok: false }, { status: 401 });

  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const headers = new Headers();

  if (intent === "enrolled") {
    // Trust but verify: only suppress + record if a passkey actually landed.
    const count = await prisma.passkey.count({
      where: { userId: user.sub },
    });
    if (count > 0) {
      setPasskeyPromptDismissed(headers);
      await logAuditEvent({
        action: "auth.passkey.register",
        userId: user.sub,
        metadata: { passkeyCount: count, via: "prompt" },
        request,
      });
    }
    return Response.json({ ok: true }, { headers });
  }

  if (intent === "dismiss") {
    setPasskeyPromptDismissed(headers);
    return Response.json({ ok: true }, { headers });
  }

  return Response.json({ ok: false, error: "unknown intent" }, { status: 400 });
}
