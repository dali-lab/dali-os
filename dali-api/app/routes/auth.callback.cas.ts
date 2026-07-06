import type { Route } from "./+types/auth.callback.cas";
import { requireAuth, validateCasTicket } from "~/lib/auth";
import { issueSession } from "~/lib/session";
import { setSessionCookie } from "~/lib/cookies";
import { getClientIp } from "~/lib/request-meta";
import { logAuditEvent } from "~/lib/audit";
import { upsertUserFromCas } from "~/lib/user-provisioning";
import { refreshDartmouthSignals } from "~/lib/dartmouth-refresh";
import { getApiBaseUrl } from "~/lib/app-env";

export async function action() {
  return new Response("Method not allowed", { status: 405 });
}

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const apiBase = getApiBaseUrl();

  const ticket = url.searchParams.get("ticket");
  const isLink = url.searchParams.get("link") === "1";

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

  // Link mode: chained from /auth/callback/google when a fresh @dali.dartmouth
  // .edu member has no netId yet. The session cookie identifies which User
  // gets the netId. Identity is the cookie, not the CAS ticket — without a
  // valid session we have no User to attach to. Fail closed.
  const linkAuth = isLink ? await requireAuth(request) : null;
  if (isLink && (!linkAuth || !linkAuth.ok)) {
    await logAuditEvent({
      action: "login.failure",
      metadata: { provider: "cas", reason: "link_without_session" },
      request,
    });
    return new Response(null, {
      status: 302,
      headers: { Location: "/login?error=link_session_missing" },
    });
  }

  const serviceUrl = isLink
    ? `${apiBase}/auth/callback/cas?link=1`
    : `${apiBase}/auth/callback/cas`;

  let casUser;
  try {
    casUser = await validateCasTicket(ticket, serviceUrl);
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

  // Link mode merges into the cookie-identified user; the existing session
  // cookie keeps working because linkCasToGoogleUser re-parents sessions to
  // the surviving User row inside the same transaction.
  if (isLink && linkAuth?.ok) {
    try {
      await upsertUserFromCas(casUser, { linkUserId: linkAuth.user.sub });
    } catch {
      await logAuditEvent({
        action: "login.failure",
        userId: linkAuth.user.sub,
        metadata: {
          provider: "cas",
          reason: "link_failed",
          netId: casUser.netId,
        },
        request,
      });
      return new Response(null, {
        status: 302,
        headers: { Location: "/?error=link_failed" },
      });
    }
    await logAuditEvent({
      action: "account.linked",
      userId: linkAuth.user.sub,
      metadata: {
        provider: "cas",
        netId: casUser.netId,
      },
      request,
    });
    return new Response(null, {
      status: 302,
      headers: { Location: "/" },
    });
  }

  const { user } = await upsertUserFromCas(casUser);

  // Fire-and-forget Dartmouth directory sync. Skipped internally when the
  // cached signals are fresh; failures are swallowed and logged. Must not
  // block login on Dartmouth API availability.
  void refreshDartmouthSignals(user.id);

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
