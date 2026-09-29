import { getAppEnv } from "~/lib/app-env";
import { prisma } from "~/lib/db";

// Tracks that a user tapped "Not now" on the first-time passkey offer, so the
// post-login prompt doesn't nag them again. This is a per-browser cookie, NOT a
// DB flag, on purpose: a passkey is bound to the device it's created on, so a
// new device is a fresh, worthwhile ask. Once the user actually enrolls a
// passkey the offer stops everywhere (the count check below short-circuits
// regardless of this cookie).
export const PASSKEY_PROMPT_COOKIE = "dali_pk_prompt";

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return null;
}

export function passkeyPromptDismissed(request: Request): boolean {
  return readCookie(request, PASSKEY_PROMPT_COOKIE) === "1";
}

export function setPasskeyPromptDismissed(headers: Headers): void {
  const secure = getAppEnv() !== "dev";
  headers.append(
    "Set-Cookie",
    [
      `${PASSKEY_PROMPT_COOKIE}=1`,
      "Path=/",
      "Max-Age=34560000", // ~400 days (browsers cap cookie lifetime here)
      "HttpOnly",
      "SameSite=Lax",
      ...(secure ? ["Secure"] : []),
    ].join("; "),
  );
}

// Offer the first-time passkey prompt only when the user has no passkey yet and
// hasn't dismissed the offer on this device.
export async function shouldOfferPasskey(
  request: Request,
  userId: string,
): Promise<boolean> {
  if (passkeyPromptDismissed(request)) return false;
  const count = await prisma.passkey.count({ where: { userId } });
  return count === 0;
}
