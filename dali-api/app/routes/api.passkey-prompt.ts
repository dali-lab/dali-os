import type { Route } from "./+types/api.passkey-prompt";
import { getBetterAuthUser } from "~/lib/betterauth-compat.server";
import { prisma } from "~/lib/db.server";
import {
  shouldOfferPasskey,
  setPasskeyPromptDismissed,
} from "~/lib/passkey-prompt.server";

// Backs the in-app passkey enrollment prompt (PasskeyEnrollmentPrompt), which
// reaches users the post-login /welcome offer misses — notably members migrated
// by the silent legacy→BetterAuth session upgrade, who never hit the login flow.
//
// GET  → eligibility ({ offer }). Only when passwordless auth is live, the user
//        has no passkey yet, and they haven't dismissed on this device.
// POST → the user acted: "dismiss" (Not now) or "enrolled" (WebAuthn ceremony
//        completed client-side). Both set the per-device dismissal cookie so we
//        don't nag again. The enrollment itself is audit-logged server-side by
//        the BetterAuth after-hook (auditPasskeyMutation) when the ceremony hits
//        /passkey/verify-registration — this route only manages the nag cookie.

export async function loader({ request }: Route.LoaderArgs) {
  // Require a BetterAuth session, not just any session: enrollment hits a
  // BetterAuth endpoint, so a user still on a legacy session (requireAuth would
  // honor it) would get a 401 from the ceremony. The legacy-session upgrade
  // converts them first.
  const user = await getBetterAuthUser(request);
  if (!user) return { offer: false };
  return { offer: await shouldOfferPasskey(request, user.sub) };
}

export async function action({ request }: Route.ActionArgs) {
  const user = await getBetterAuthUser(request);
  if (!user) return Response.json({ ok: false }, { status: 401 });

  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const headers = new Headers();

  if (intent === "enrolled") {
    // Trust but verify: only suppress the nag if a passkey actually landed. The
    // registration is audit-logged by the BetterAuth after-hook, not here.
    const count = await prisma.passkey.count({
      where: { userId: user.sub },
    });
    if (count > 0) {
      setPasskeyPromptDismissed(headers);
    }
    return Response.json({ ok: true }, { headers });
  }

  if (intent === "dismiss") {
    setPasskeyPromptDismissed(headers);
    return Response.json({ ok: true }, { headers });
  }

  return Response.json({ ok: false, error: "unknown intent" }, { status: 400 });
}
