import type { Route } from "./+types/settings.connected-apps";
import { redirect } from "react-router";
import { requireAuth } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { prisma } from "~/lib/db";
import { logAuditEvent } from "~/lib/audit";
import { revokeAllForGrant } from "~/lib/session";

export const meta: Route.MetaFunction = () => [{ title: "Settings · DALI OS" }];

export async function loader() {
  return redirect("/settings/connections");
}

export async function action({ request }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);

  const form = await request.formData();
  const grantId = form.get("grantId");
  if (typeof grantId !== "string") {
    return redirect("/settings/connections");
  }

  const grant = await prisma.oAuthGrant.findUnique({ where: { id: grantId } });
  if (!grant || grant.userId !== auth.user.sub) {
    return redirect("/settings/connections");
  }

  await prisma.oAuthGrant.update({
    where: { id: grantId },
    data: { revokedAt: new Date() },
  });
  await revokeAllForGrant(grantId);
  await prisma.authSession.deleteMany({ where: { grantId } });
  await logAuditEvent({
    action: "oauth.grant.revoke",
    userId: auth.user.sub,
    targetId: grantId,
    metadata: { clientId: grant.clientId, clientName: grant.name },
    request,
  });

  return redirect("/settings/connections");
}

export default function ConnectedAppsRedirect() {
  return null;
}
