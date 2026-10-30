import type { Route } from "./+types/api.mobile.webview";
import { z } from "zod";
import { prisma } from "~/lib/db.server";
import { parseJson } from "~/lib/validate";
import { generateRawCode, hashCode, HANDOFF_TTL_MS } from "~/lib/pairing";
import { getApiBaseUrl } from "~/lib/app-env";
import { mobileError, mobileJson, requireMobileUser } from "~/lib/mobile-auth.server";

const BodySchema = z.object({ pageId: z.string().min(1).max(64) });

// POST { pageId } -> { url }: a one-time /auth/handoff link that signs the app's
// WebView in and lands it on the page's editor. Minted against the device
// pairing behind this app session, the same single-use code the pairing poll
// hands the desktop app; the session cookie itself never travels in a URL.
export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") return mobileError("Method not allowed", 405);
  const guard = await requireMobileUser(request);
  if (!guard.ok) return guard.response;
  const body = await parseJson(request, BodySchema);
  if (body instanceof Response) return body;

  const code = generateRawCode();
  const minted = await prisma.devicePairing.updateMany({
    where: { desktopSessionId: guard.auth.sessionId, userId: guard.userId, status: "Consumed" },
    data: { handoffCodeHash: hashCode(code), handoffExpiresAt: new Date(Date.now() + HANDOFF_TTL_MS), handoffUsedAt: null },
  });
  if (minted.count === 0) return mobileError("Sign in again to edit notes.", 409);

  const next = `/documents/${encodeURIComponent(body.pageId)}?embed=1`;
  return mobileJson({
    url: `${getApiBaseUrl()}/auth/handoff?code=${encodeURIComponent(code)}&next=${encodeURIComponent(next)}`,
  });
}
