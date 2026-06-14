import type { Route } from "./+types/oauth.consent";
import { Form, redirect } from "react-router";
import { prisma } from "~/lib/db";
import { getOAuthClient, generateAuthorizationCode } from "~/lib/oauth";
import { parseSessionId } from "~/lib/cookies";
import { lookupSession } from "~/lib/session";
import { displayEmail } from "~/lib/display";

const SCOPE_DESCRIPTIONS: Record<string, string> = {
  "mcp:read": "Read your DALI OS data on your behalf",
  "mcp:write": "Make changes to DALI OS on your behalf",
};

type LoaderData =
  | {
      ok: true;
      sessionId: string;
      clientName: string;
      scopes: string[];
      userEmail: string;
    }
  | { ok: false; error: string };

export async function loader({ request }: Route.LoaderArgs): Promise<LoaderData> {
  const url = new URL(request.url);
  const sessionId = url.searchParams.get("session_id");
  if (!sessionId) return { ok: false, error: "Missing session_id" };

  const oauthSession = await prisma.oAuthSession.findUnique({
    where: { id: sessionId },
  });
  if (!oauthSession || oauthSession.expiresAt < new Date() || oauthSession.exchanged) {
    return { ok: false, error: "Authorization request expired" };
  }
  if (!oauthSession.userId || !oauthSession.clientId) {
    return { ok: false, error: "Authorization request not yet authenticated" };
  }

  // The consent screen is rendered to the user who completed IDP login.
  // Cross-check via the cookie session so a leaked session_id can't grant
  // someone else's authorization.
  const rawSid = parseSessionId(request);
  if (!rawSid) {
    return { ok: false, error: "You must be signed in to authorize this app" };
  }
  const browserSession = await lookupSession(rawSid);
  if (
    !browserSession ||
    browserSession.revokedAt ||
    browserSession.userId !== oauthSession.userId
  ) {
    return { ok: false, error: "Session mismatch" };
  }

  const client = await getOAuthClient(oauthSession.clientId);
  if (!client) return { ok: false, error: "Unknown client" };

  const user = await prisma.user.findUnique({
    where: { id: oauthSession.userId },
    select: { daliEmail: true, dartmouthEmail: true, netId: true },
  });
  const userEmail = (user ? displayEmail(user) : "") || "(unknown)";

  return {
    ok: true,
    sessionId: oauthSession.id,
    clientName: client.name,
    scopes: oauthSession.scopes ?? [],
    userEmail,
  };
}

export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData();
  const sessionId = form.get("session_id");
  const decision = form.get("decision");
  if (typeof sessionId !== "string" || typeof decision !== "string") {
    return redirect("/login?error=consent_invalid");
  }

  const oauthSession = await prisma.oAuthSession.findUnique({
    where: { id: sessionId },
  });
  if (!oauthSession || oauthSession.expiresAt < new Date() || oauthSession.exchanged) {
    return redirect("/login?error=consent_expired");
  }
  if (!oauthSession.userId || !oauthSession.clientId) {
    return redirect("/login?error=consent_invalid");
  }

  const rawSid = parseSessionId(request);
  if (!rawSid) return redirect("/login?error=consent_unauthenticated");
  const browserSession = await lookupSession(rawSid);
  if (
    !browserSession ||
    browserSession.revokedAt ||
    browserSession.userId !== oauthSession.userId
  ) {
    return redirect("/login?error=consent_mismatch");
  }

  if (decision !== "approve") {
    const params = new URLSearchParams({
      error: "access_denied",
      error_description: "user_denied",
      state: oauthSession.state,
    });
    return redirect(`${oauthSession.redirectUri}?${params}`);
  }

  const client = await getOAuthClient(oauthSession.clientId);
  if (!client) return redirect("/login?error=unknown_client");

  // Upsert the grant. The /oauth/token exchange will also touch lastUsedAt
  // and union in the scopes once it issues the session; we set them here so
  // /settings/connected-apps reflects the approval before the code redeems.
  const existing = await prisma.oAuthGrant.findUnique({
    where: {
      userId_clientId: { userId: oauthSession.userId, clientId: client.clientId },
    },
  });
  const nextScopes = Array.from(
    new Set([...(existing?.scopes ?? []), ...(oauthSession.scopes ?? [])]),
  );
  await prisma.oAuthGrant.upsert({
    where: {
      userId_clientId: { userId: oauthSession.userId, clientId: client.clientId },
    },
    update: { scopes: nextScopes, revokedAt: null },
    create: {
      userId: oauthSession.userId,
      clientId: client.clientId,
      name: client.name,
      scopes: nextScopes,
    },
  });

  const code = await generateAuthorizationCode(
    oauthSession.id,
    oauthSession.userId,
  );
  const params = new URLSearchParams({ code, state: oauthSession.state });
  return redirect(`${oauthSession.redirectUri}?${params}`);
}

export default function ConsentScreen({ loaderData }: Route.ComponentProps) {
  if (!loaderData.ok) {
    return (
      <main className="mx-auto max-w-md p-8 text-foreground">
        <h1 className="text-xl font-semibold">Authorization unavailable</h1>
        <p className="mt-2 text-sm text-muted-foreground">{loaderData.error}</p>
      </main>
    );
  }
  const { sessionId, clientName, scopes, userEmail } = loaderData;
  return (
    <main className="mx-auto max-w-md p-8 text-foreground">
      <h1 className="text-xl font-semibold">
        Authorize {clientName}?
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Signed in as <strong className="text-foreground">{userEmail}</strong>.
      </p>
      <p className="mt-4 text-sm text-foreground/90">
        <strong>{clientName}</strong> is requesting:
      </p>
      <ul className="mt-3 space-y-2">
        {scopes.length === 0 ? (
          <li className="text-sm text-muted-foreground">Basic profile (no scopes requested)</li>
        ) : (
          scopes.map((s) => (
            <li
              key={s}
              className="rounded border border-border bg-card px-3 py-2 text-sm"
            >
              <code className="font-mono text-xs text-foreground">{s}</code>
              <div className="text-xs text-muted-foreground">
                {SCOPE_DESCRIPTIONS[s] ?? "Custom scope"}
              </div>
            </li>
          ))
        )}
      </ul>
      <Form method="post" className="mt-6 flex gap-2">
        <input type="hidden" name="session_id" value={sessionId} />
        <button
          type="submit"
          name="decision"
          value="approve"
          className="flex-1 rounded bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          Authorize
        </button>
        <button
          type="submit"
          name="decision"
          value="deny"
          className="flex-1 rounded border border-border bg-card px-4 py-2 text-sm font-medium text-foreground hover:bg-muted"
        >
          Cancel
        </button>
      </Form>
    </main>
  );
}
