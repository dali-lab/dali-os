import { redirect } from "react-router";
import { requireAuth } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { prisma } from "~/lib/db";
import type { Route } from "./+types/settings.sessions";

export const meta: Route.MetaFunction = () => [{ title: "Settings · DALI OS" }];

export async function loader() {
  return redirect("/settings#devices");
}

export async function action({ request }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);

  const form = await request.formData();
  const intent = form.get("intent");

  if (intent === "revoke-one") {
    const sessionId = form.get("sessionId");
    if (typeof sessionId !== "string") {
      return redirect("/settings#devices");
    }
    await prisma.session.updateMany({
      where: { id: sessionId, userId: auth.user.sub, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return redirect("/settings#devices");
  }

  if (intent === "revoke-others") {
    await prisma.session.updateMany({
      where: {
        userId: auth.user.sub,
        revokedAt: null,
        NOT: { id: auth.sessionId },
      },
      data: { revokedAt: new Date() },
    });
    return redirect("/settings#devices");
  }

  return redirect("/settings#devices");
}

export default function SettingsSessionsRedirect() {
  return null;
}
