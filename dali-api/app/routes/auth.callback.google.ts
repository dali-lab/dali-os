import type { Route } from "./+types/auth.callback.google";
import { prisma } from "~/lib/db";
import { exchangeGoogleCode } from "~/lib/oauth";
import { issueSession } from "~/lib/session";
import { setSessionCookie } from "~/lib/cookies";
import { getClientIp } from "~/lib/request-meta";
import { logAuditEvent } from "~/lib/audit";
import { requireAuth } from "~/lib/auth";
import { CAL_STATE_PREFIX } from "~/routes/oauth.calendar.google.start";
import { handleCalendarLinkCallback } from "~/routes/oauth.calendar.google.callback";

const OAUTH_STATE_COOKIE = "__dali_oauth_state";
const ACCOUNT_TYPE_COOKIE = "__dali_account_type";

function parseCookies(request: Request): Record<string, string> {
  const header = request.headers.get("Cookie") ?? "";
  const entries: Record<string, string> = {};
  for (const part of header.split(";")) {
    const [k, ...rest] = part.split("=");
    if (k) entries[k.trim()] = rest.join("=").trim();
  }
  return entries;
}

export async function action() {
  return new Response("Method not allowed", { status: 405 });
}

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const apiBase = process.env.API_BASE_URL ?? "http://localhost:3001";

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const googleError = url.searchParams.get("error");

  // Calendar-link flow: state is prefixed with "cal:" by /oauth/calendar/google/start.
  // Dispatch to the helper, which writes to UserCalendarLink for the logged-in user.
  if (state?.startsWith(CAL_STATE_PREFIX)) {
    const auth = await requireAuth(request);
    if (!auth.ok) {
      return new Response(null, { status: 302, headers: { Location: "/login" } });
    }
    if (auth.user.type === "applicant") {
      return new Response(null, { status: 302, headers: { Location: "/portal" } });
    }
    if (googleError || !code) {
      return new Response(null, {
          status: 302,
          headers: { Location: "/calendar?calendar_link_error=auth_failed" },
        });
    }
    const response = await handleCalendarLinkCallback({
      request,
      userId: auth.user.sub,
      code,
      state,
    });
    return response;
  }

  if (googleError || !code || !state) {
    await logAuditEvent({
      action: "login.failure",
      metadata: { provider: "google", reason: "missing_code" },
      request,
    });
    return new Response(null, {
      status: 302,
      headers: { Location: "/login?error=google_auth_failed" },
    });
  }

  // CSRF validation
  const cookies = parseCookies(request);
  const savedState = cookies[OAUTH_STATE_COOKIE];
  const clearStateCookie = `${OAUTH_STATE_COOKIE}=; Path=/auth/callback/google; Max-Age=0; HttpOnly; SameSite=Lax`;

  if (!savedState || savedState !== state) {
    await logAuditEvent({
      action: "login.failure",
      metadata: { provider: "google", reason: "state_mismatch" },
      request,
    });
    return new Response(null, {
      status: 302,
      headers: {
        "Set-Cookie": clearStateCookie,
        Location: "/login?error=server_error",
      },
    });
  }

  // Exchange Google code for user info
  let googleUser;
  try {
    googleUser = await exchangeGoogleCode(code, `${apiBase}/auth/callback/google`);
  } catch {
    await logAuditEvent({
      action: "login.failure",
      metadata: { provider: "google", reason: "code_exchange_failed" },
      request,
    });
    return new Response(null, {
      status: 302,
      headers: {
        "Set-Cookie": clearStateCookie,
        Location: "/login?error=server_error",
      },
    });
  }

  // Determine account type from the cookie set during the login action
  const accountType = cookies[ACCOUNT_TYPE_COOKIE] ?? "";
  const clearAccountTypeCookie = `${ACCOUNT_TYPE_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`;
  const isMemberLogin = accountType === "member";

  // For member login, enforce DALI domain
  if (isMemberLogin && !googleUser.email.endsWith("@dali.dartmouth.edu")) {
    await logAuditEvent({
      action: "login.failure",
      metadata: {
        provider: "google",
        reason: "domain_denied",
        email: googleUser.email,
      },
      request,
    });
    const headers = new Headers();
    headers.append("Set-Cookie", clearStateCookie);
    headers.append("Set-Cookie", clearAccountTypeCookie);
    headers.set("Location", "/login?error=access_denied");
    return new Response(null, { status: 302, headers });
  }

  let user;
  let authType: string;
  let redirectTo: string;

  if (googleUser.email.endsWith("@dali.dartmouth.edu")) {
    // DALI member flow
    user = await prisma.user.upsert({
      where: { daliEmail: googleUser.email },
      update: { firstName: googleUser.firstName, lastName: googleUser.lastName },
      create: {
        daliEmail: googleUser.email,
        firstName: googleUser.firstName,
        lastName: googleUser.lastName,
      },
    });

    // Ensure a DALIMember record exists for this DALI user.
    const existingMember = await prisma.dALIMember.findFirst({
      where: { OR: [{ userId: user.id }, { daliEmail: googleUser.email }] },
    });
    if (existingMember) {
      if (!existingMember.userId) {
        await prisma.dALIMember.update({
          where: { id: existingMember.id },
          data: { userId: user.id },
        });
      }
    } else {
      await prisma.dALIMember.create({
        data: { userId: user.id, daliEmail: googleUser.email },
      });
    }

    authType = "member";
    redirectTo = "/hiring/reviewer";
  } else if (googleUser.email.endsWith("@dartmouth.edu")) {
    // Dartmouth student via Google (non-DALI email)
    user = await prisma.user.upsert({
      where: { dartmouthEmail: googleUser.email },
      update: { firstName: googleUser.firstName, lastName: googleUser.lastName },
      create: {
        dartmouthEmail: googleUser.email,
        firstName: googleUser.firstName,
        lastName: googleUser.lastName,
      },
    });
    authType = "dartmouth";
    redirectTo = "/portal";
  } else {
    // External partner — any Google account
    // Use a findFirst+create pattern since there's no unique constraint on generic emails
    let existing = await prisma.user.findFirst({
      where: { dartmouthEmail: googleUser.email },
    });
    if (existing) {
      user = await prisma.user.update({
        where: { id: existing.id },
        data: { firstName: googleUser.firstName, lastName: googleUser.lastName },
      });
    } else {
      user = await prisma.user.create({
        data: {
          dartmouthEmail: googleUser.email,
          firstName: googleUser.firstName,
          lastName: googleUser.lastName,
        },
      });
    }
    authType = "partner";
    redirectTo = "/portal";
  }

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
      provider: "google",
      authType,
      email: googleUser.email,
    },
    request,
  });
  const headers = new Headers();
  headers.append("Set-Cookie", clearStateCookie);
  headers.append("Set-Cookie", clearAccountTypeCookie);
  setSessionCookie(headers, session.rawId);
  headers.set("Location", redirectTo);

  return new Response(null, { status: 302, headers });
}
