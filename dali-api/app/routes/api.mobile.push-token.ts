import type { Route } from "./+types/api.mobile.push-token";
import { prisma } from "~/lib/db";
import { mobileError, mobileJson, requireMobileUser } from "~/lib/mobile-auth.server";
import { parsePushTokenBody } from "~/lib/mobile-format";

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST" && request.method !== "DELETE") return mobileError("Method not allowed", 405);
  const guard = await requireMobileUser(request);
  if (!guard.ok) return guard.response;
  const body = parsePushTokenBody(await request.json().catch(() => null));
  if (!body) return mobileError("Invalid push token", 400);

  if (request.method === "DELETE") {
    await prisma.mobilePushToken.deleteMany({ where: { token: body.token, userId: guard.userId } });
    return mobileJson({ ok: true });
  }

  const { platform } = body;
  if (!platform) return mobileError("platform must be 'ios' or 'android'", 400);
  const now = new Date();
  await prisma.mobilePushToken.upsert({
    where: { token: body.token },
    create: { token: body.token, platform, userId: guard.userId, lastSeenAt: now },
    update: { platform, userId: guard.userId, lastSeenAt: now },
  });
  return mobileJson({ ok: true });
}
