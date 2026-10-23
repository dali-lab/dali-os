import { APIError } from "better-auth/api";
import { logAuditEvent } from "~/lib/audit";
import { getClientIpFromHeaders } from "~/lib/rate-limit";

// Counted in Postgres (AuditLog) rather than the in-memory rate limiter: prod
// runs several Fly machines, each with its own memory, so a per-process cap was
// multiplied by the machine count and let a scripted loop mail ~1 code/second.
//
// Every request is counted, whether or not the address has an account. Counting
// only real sends would make the 429 itself reveal which addresses exist.

const SEND_PATH = "/email-otp/send-verification-otp";
const REQUEST_ACTION = "auth.code.request";

export const OTP_SEND_WINDOW_MS = 10 * 60_000;
export const OTP_SEND_MAX_PER_EMAIL = 3;
export const OTP_SEND_MAX_PER_IP = 10;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function throttleOtpSend(ctx: any): Promise<void> {
  if (ctx?.path !== SEND_PATH) return;
  const email = ctx?.body?.email;
  if (typeof email !== "string" || email.trim() === "") return;

  const normalized = email.trim().toLowerCase();
  const headers: Headers | undefined = ctx?.request?.headers ?? ctx?.headers;
  const ip = headers ? getClientIpFromHeaders(headers) : "unknown";
  const userAgent = headers?.get("User-Agent") ?? null;
  const metadata = { email: normalized, type: String(ctx?.body?.type ?? "") };

  let limited = false;
  try {
    const { prisma } = await import("~/lib/db");
    const since = new Date(Date.now() - OTP_SEND_WINDOW_MS);
    const base = { action: REQUEST_ACTION, createdAt: { gte: since } };
    const [byEmail, byIp] = await Promise.all([
      prisma.auditLog.count({
        where: { ...base, metadata: { path: ["email"], equals: normalized } },
      }),
      ip === "unknown" ? 0 : prisma.auditLog.count({ where: { ...base, ip } }),
    ]);
    limited = byEmail >= OTP_SEND_MAX_PER_EMAIL || byIp >= OTP_SEND_MAX_PER_IP;
  } catch (err) {
    // Fail open: a broken count must not lock everyone out of sign-in.
    console.error(
      "[auth:otp-throttle] count failed, allowing send:",
      err instanceof Error ? err.message : String(err),
    );
  }

  await logAuditEvent({
    action: limited ? "auth.code.throttled" : REQUEST_ACTION,
    metadata,
    ip,
    userAgent,
  });

  if (limited) {
    throw new APIError("TOO_MANY_REQUESTS", {
      message: "Too many sign-in codes requested. Try again in a few minutes.",
    });
  }
}
