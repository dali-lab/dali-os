// Finishes the mailbox connect started by /oauth/mail/google/start: exchanges
// the code, confirms Gmail access was granted and that the signed-in address
// is the one this target expects, then stores the encrypted tokens.
//
// Google returns here through the calendar-link callback, whose redirect URI
// is already registered on the OAuth client in every environment — so a
// mailbox connect needs no Google Cloud change. That route hands a request
// over when isMailConnectCallback() recognises it by this flow's own cookie.

import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { getApiBaseUrl } from "~/lib/app-env";
import { buildEncryptedTokens } from "~/lib/google-calendar";
import { exchangeGoogleCode, GoogleOAuthError, resolveGoogleEmail } from "~/lib/google-oauth";
import { GMAIL_MODIFY_SCOPE } from "~/email/lib/gmail-mailbox.server";
import { expectedConnectAddress, parseConnectTarget } from "~/email/lib/access.server";

export const MAIL_STATE_COOKIE = "__dali_mail_oauth_state";

/** The redirect URI both halves of the mailbox connect send to Google. */
export function mailConnectRedirectUri(): string {
  return `${getApiBaseUrl()}/integrations/calendar/google/callback`;
}

function readStateCookie(request: Request): string | null {
  for (const part of (request.headers.get("Cookie") ?? "").split(";")) {
    const [k, ...rest] = part.split("=");
    if (k?.trim() === MAIL_STATE_COOKIE) return rest.join("=").trim();
  }
  return null;
}

function redirectToEmail(qs: string) {
  return new Response(null, {
    status: 302,
    headers: {
      "Set-Cookie": `${MAIL_STATE_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`,
      Location: `/email?${qs}`,
    },
  });
}

/** Whether a callback request belongs to a mailbox connect (its state matches this flow's cookie). */
export function isMailConnectCallback(request: Request): boolean {
  const state = new URL(request.url).searchParams.get("state");
  const [cookieState] = (readStateCookie(request) ?? "").split(".");
  return Boolean(state && cookieState && cookieState === state);
}

export async function completeMailConnect(request: Request): Promise<Response> {
  const auth = await requireAuth(request);
  if (!auth.ok) return new Response(null, { status: 302, headers: { Location: "/login" } });
  const userId = auth.user.sub;

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (url.searchParams.get("error") || !code || !state) {
    return redirectToEmail("mail_error=auth_failed");
  }

  const [cookieState, encodedTarget] = (readStateCookie(request) ?? "").split(".");
  if (!cookieState || cookieState !== state || !encodedTarget) {
    return redirectToEmail("mail_error=state_mismatch");
  }
  const target = parseConnectTarget(Buffer.from(encodedTarget, "base64url").toString("utf8"));
  if (!target) return redirectToEmail("mail_error=state_mismatch");
  const expected = await expectedConnectAddress(userId, target, request);
  if (expected === undefined) return redirectToEmail("mail_error=forbidden");

  let tokens;
  try {
    tokens = await exchangeGoogleCode({
      code,
      redirectUri: mailConnectRedirectUri(),
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    });
  } catch (err) {
    if (err instanceof GoogleOAuthError) return redirectToEmail("mail_error=token_exchange_failed");
    throw err;
  }
  if (tokens.scope && !tokens.scope.split(" ").includes(GMAIL_MODIFY_SCOPE)) {
    return redirectToEmail("mail_error=scope_denied");
  }
  if (!tokens.refresh_token) return redirectToEmail("mail_error=no_refresh_token");

  const address = (await resolveGoogleEmail(tokens.id_token, tokens.access_token))?.toLowerCase();
  if (!address) return redirectToEmail("mail_error=no_email");
  if (address !== expected.toLowerCase()) {
    return redirectToEmail("mail_error=wrong_account");
  }

  const oauthTokens = buildEncryptedTokens({
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresInSec: tokens.expires_in ?? null,
  });
  // Every inbox is signed in to per person, never once for everyone.
  let accountId: string;
  if (target.kind === "Shared") {
    accountId = target.accountId;
  } else {
    const owner =
      target.kind === "Personal"
        ? { kind: "Personal" as const, scopeKey: `user:${userId}`, userId }
        : { kind: "Project" as const, scopeKey: `project:${target.projectId}`, projectId: target.projectId };
    const account = await prisma.mailAccount.upsert({
      where: { scopeKey_address: { scopeKey: owner.scopeKey, address } },
      create: { ...owner, address },
      update: {},
      select: { id: true },
    });
    accountId = account.id;
  }
  await prisma.mailAccountConnection.upsert({
    where: { accountId_userId: { accountId, userId } },
    create: { accountId, userId, oauthTokens },
    update: { oauthTokens, syncError: null, connectedAt: new Date() },
  });

  return redirectToEmail("mail_connected=1");
}
