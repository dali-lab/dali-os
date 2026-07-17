// POST /auth/pair/approve — requires an authenticated web session (the user
// approving in the system browser). Binds the pending DevicePairing to the user
// (approve) or cancels it. The desktop token is NOT minted here — that's
// deferred to the consuming poll so the secret is born on the polling channel.
// Posted from the /link approval page. See TAURI_DESKTOP_PLAN.md.

import { redirect } from "react-router";
import type { Route } from "./+types/auth.pair.approve";
import { requireAuth } from "~/lib/auth";
import { prisma } from "~/lib/db";
import { logAuditEvent } from "~/lib/audit";
import { formatUserCode, normalizeUserCode } from "~/lib/pairing";

export async function action({ request }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");

  const form = await request.formData();
  const intent = form.get("intent");
  const userCodeRaw = form.get("userCode");
  if (typeof userCodeRaw !== "string") return redirect("/link");
  const userCode = normalizeUserCode(userCodeRaw);
  const display = encodeURIComponent(formatUserCode(userCode));

  if (intent === "cancel") {
    await prisma.devicePairing.updateMany({
      where: { userCode, status: "Pending" },
      data: { status: "Cancelled" },
    });
    await logAuditEvent({ action: "pairing.cancel", userId: auth.user.sub, request });
    return redirect(`/link?code=${display}&result=cancelled`);
  }

  // Approve: status-guarded so a stale/expired/used code binds nothing.
  const res = await prisma.devicePairing.updateMany({
    where: { userCode, status: "Pending", expiresAt: { gt: new Date() } },
    data: { status: "Approved", userId: auth.user.sub, approvedAt: new Date() },
  });

  if (res.count === 0) {
    return redirect(`/link?code=${display}&result=stale`);
  }
  await logAuditEvent({ action: "pairing.approve", userId: auth.user.sub, request });
  return redirect(`/link?code=${display}&result=approved`);
}
