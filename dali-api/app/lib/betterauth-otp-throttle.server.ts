import { APIError } from "better-auth/api";
import { logAuditEvent } from "~/lib/audit";
import { auditBlockedHit, autoBlockIp, isIpBlocked, isIpTrusted } from "~/lib/ip-rules.server";
import { getClientIpFromHeaders } from "~/lib/rate-limit";

// Counted in Postgres (AuditLog) rather than the in-memory rate limiter: prod
// runs several Fly machines, each with its own memory, so a per-process cap was
// multiplied by the machine count and let a scripted loop mail ~1 code/second.
//
// Every request is counted, whether or not the address has an account. Counting
// only real sends would make the 429 itself reveal which addresses exist.
//
// Trusted networks (campus NAT/eduroam) put many members behind one address, so
// they get a higher per-IP cap, no daily cap, and are never auto-blocked. The
// per-email caps are the same everywhere: they bound what one member can
// receive however many addresses a sender rotates through.
//
// Sign-in codes and magic links share one bucket, so the caps bound every
// sign-in email a member can be sent, not each kind separately.

const OTP_PATH = "/email-otp/send-verification-otp";
const MAGIC_LINK_PATH = "/sign-in/magic-link";
const REQUEST_ACTION = "auth.code.request";
const THROTTLED_ACTION = "auth.code.throttled";

export const OTP_SEND_WINDOW_MS = 10 * 60_000;
export const OTP_SEND_MAX_PER_EMAIL = 3;
export const OTP_SEND_HOUR_MS = 60 * 60_000;
export const OTP_SEND_MAX_PER_EMAIL_HOUR = 5;
export const OTP_SEND_MAX_PER_EMAIL_DAY = 10;
export const OTP_SEND_MAX_PER_IP = 10;
export const OTP_SEND_MAX_PER_TRUSTED_IP = 50;
export const OTP_SEND_DAY_MS = 24 * 60 * 60_000;
export const OTP_SEND_MAX_PER_IP_DAY = 30;
export const AUTO_BLOCK_WINDOW_MS = 60 * 60_000;
export const AUTO_BLOCK_AFTER_THROTTLES = 3;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function clientOf(ctx: any): { ip: string; userAgent: string | null } {
  const headers: Headers | undefined = ctx?.request?.headers ?? ctx?.headers;
  return {
    ip: headers ? getClientIpFromHeaders(headers) : "unknown",
    userAgent: headers?.get("User-Agent") ?? null,
  };
}

// Runs on every BetterAuth endpoint, so a blocked address can't sign in by any
// method (code, magic link, passkey, Google) or reach the session endpoints.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function rejectBlockedIp(ctx: any): Promise<void> {
  const { ip, userAgent } = clientOf(ctx);
  if (ip === "unknown" || !(await isIpBlocked(ip))) return;
  await auditBlockedHit(ip, String(ctx?.path ?? ""), userAgent);
  throw new APIError("FORBIDDEN", { message: "Sign-in is not available from this network." });
}

// /signup and the partner flow check the address's domain before calling
// auth.api.signInMagicLink, which carries no request. A direct POST to the
// endpoint would skip those checks and mail any address.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function rejectDirectMagicLink(ctx: any): void {
  if (ctx?.path === MAGIC_LINK_PATH && ctx?.request) {
    throw new APIError("NOT_FOUND");
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function throttleOtpSend(ctx: any): Promise<void> {
  const isMagicLink = ctx?.path === MAGIC_LINK_PATH;
  if (ctx?.path !== OTP_PATH && !isMagicLink) return;
  const email = ctx?.body?.email;
  if (typeof email !== "string" || email.trim() === "") return;

  const normalized = email.trim().toLowerCase();
  const { ip, userAgent } = clientOf(ctx);
  const metadata = {
    email: normalized,
    type: isMagicLink ? "magic-link" : String(ctx?.body?.type ?? ""),
  };
  const knownIp = ip !== "unknown";
  const trusted = knownIp && (await isIpTrusted(ip));

  let limited = false;
  try {
    const { prisma } = await import("~/lib/db");
    const now = Date.now();
    const recent = { action: REQUEST_ACTION, createdAt: { gte: new Date(now - OTP_SEND_WINDOW_MS) } };
    const [emailRequests, byIp, byIpDay] = await Promise.all([
      prisma.auditLog.findMany({
        where: {
          action: REQUEST_ACTION,
          createdAt: { gte: new Date(now - OTP_SEND_DAY_MS) },
          metadata: { path: ["email"], equals: normalized },
        },
        select: { createdAt: true },
      }),
      knownIp ? prisma.auditLog.count({ where: { ...recent, ip } }) : 0,
      knownIp && !trusted
        ? prisma.auditLog.count({
            where: { action: REQUEST_ACTION, ip, createdAt: { gte: new Date(now - OTP_SEND_DAY_MS) } },
          })
        : 0,
    ]);
    const emailSince = (ms: number) =>
      emailRequests.filter((r) => r.createdAt.getTime() >= now - ms).length;
    const ipCap = trusted ? OTP_SEND_MAX_PER_TRUSTED_IP : OTP_SEND_MAX_PER_IP;
    limited =
      emailSince(OTP_SEND_WINDOW_MS) >= OTP_SEND_MAX_PER_EMAIL ||
      emailSince(OTP_SEND_HOUR_MS) >= OTP_SEND_MAX_PER_EMAIL_HOUR ||
      emailRequests.length >= OTP_SEND_MAX_PER_EMAIL_DAY ||
      byIp >= ipCap ||
      (!trusted && byIpDay >= OTP_SEND_MAX_PER_IP_DAY);
  } catch (err) {
    // Fail open: a broken count must not lock everyone out of sign-in.
    console.error(
      "[auth:otp-throttle] count failed, allowing send:",
      err instanceof Error ? err.message : String(err),
    );
  }

  await logAuditEvent({
    action: limited ? THROTTLED_ACTION : REQUEST_ACTION,
    metadata,
    ip,
    userAgent,
  });

  if (!limited) return;
  if (knownIp && !trusted) await maybeAutoBlock(ip);
  throw new APIError("TOO_MANY_REQUESTS", {
    message: "Too many sign-in codes requested. Try again in a few minutes.",
  });
}

async function maybeAutoBlock(ip: string): Promise<void> {
  try {
    const { prisma } = await import("~/lib/db");
    const throttles = await prisma.auditLog.count({
      where: {
        action: THROTTLED_ACTION,
        ip,
        createdAt: { gte: new Date(Date.now() - AUTO_BLOCK_WINDOW_MS) },
      },
    });
    if (throttles >= AUTO_BLOCK_AFTER_THROTTLES) {
      await autoBlockIp(ip, `${throttles} refused sign-in code requests within an hour`);
    }
  } catch (err) {
    console.error(
      "[auth:otp-throttle] auto-block failed:",
      err instanceof Error ? err.message : String(err),
    );
  }
}
