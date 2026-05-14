import type { Route } from "./+types/auth.callback.cas";
import { prisma } from "~/lib/db";
import { validateCasTicket } from "~/lib/auth";
import { issueSession } from "~/lib/session";
import { setSessionCookie } from "~/lib/cookies";
import { getClientIp } from "~/lib/request-meta";
import { logAuditEvent } from "~/lib/audit";

export async function action() {
  return new Response("Method not allowed", { status: 405 });
}

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const apiBase = process.env.API_BASE_URL ?? "http://localhost:3001";

  const ticket = url.searchParams.get("ticket");

  if (!ticket) {
    await logAuditEvent({
      action: "login.failure",
      metadata: { provider: "cas", reason: "missing_ticket" },
      request,
    });
    return new Response(null, {
      status: 302,
      headers: { Location: "/login?error=cas_auth_failed" },
    });
  }

  // Validate CAS ticket
  let casUser;
  try {
    casUser = await validateCasTicket(ticket, `${apiBase}/auth/callback/cas`);
  } catch {
    await logAuditEvent({
      action: "login.failure",
      metadata: { provider: "cas", reason: "ticket_validation_failed" },
      request,
    });
    return new Response(null, {
      status: 302,
      headers: { Location: "/login?error=cas_auth_failed" },
    });
  }

  // Upsert user with CAS-derived info
  const dartmouthEmail = `${casUser.netId}@dartmouth.edu`;
  const user = await prisma.user.upsert({
    where: { netId: casUser.netId },
    update: {
      firstName: casUser.firstName,
      lastName: casUser.lastName,
      dartmouthEmail,
    },
    create: {
      netId: casUser.netId,
      firstName: casUser.firstName,
      lastName: casUser.lastName,
      dartmouthEmail,
    },
  });

  // Issue session and set cookie
  const session = await issueSession({
    userId: user.id,
    userAgent: request.headers.get("user-agent") ?? undefined,
    ip: getClientIp(request),
  });
  await logAuditEvent({
    action: "login.success",
    userId: user.id,
    metadata: {
      provider: "cas",
      authType: "dartmouth",
      netId: casUser.netId,
    },
    request,
  });
  const headers = new Headers();
  setSessionCookie(headers, session.rawId);
  headers.set("Location", "/portal");

  return new Response(null, { status: 302, headers });
}
