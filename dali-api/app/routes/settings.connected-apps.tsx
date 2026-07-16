import type { Route } from "./+types/settings.connected-apps";
import { redirect } from "react-router";
import { requireAuth } from "~/lib/auth";
import { prisma } from "~/lib/db";
import { revokeAllForGrant } from "~/lib/session";

export const meta: Route.MetaFunction = () => [{ title: "Settings · DALI OS" }];

export async function loader() {
  return redirect("/settings#connected-apps");
}

export async function action({ request }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");

  const form = await request.formData();
  const grantId = form.get("grantId");
  if (typeof grantId !== "string") {
    return redirect("/settings#connected-apps");
  }

  const grant = await prisma.oAuthGrant.findUnique({ where: { id: grantId } });
  if (!grant || grant.userId !== auth.user.sub) {
    return redirect("/settings#connected-apps");
  }

  await prisma.oAuthGrant.update({
    where: { id: grantId },
    data: { revokedAt: new Date() },
  });
  await revokeAllForGrant(grantId);

  return redirect("/settings#connected-apps");
}

export default function ConnectedAppsRedirect() {
  return null;
}
