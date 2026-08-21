import { randomBytes } from "node:crypto";
import { useEffect, useState } from "react";
import { Form, redirect, useActionData, useNavigation } from "react-router";
import type { Route } from "./+types/partner.login";
import { requireAuth } from "~/lib/auth";
import { prisma } from "~/lib/db";
import { checkRateLimit } from "~/lib/rate-limit";
import { getApiBaseUrl, getAppEnv } from "~/lib/app-env";
import { buildGoogleAuthUrl } from "~/lib/google-oauth";
import {
  issuePartnerMagicLink,
  normalizeEmail,
} from "~/partners/lib/magic-link.server";

// UI resend cooldown. The server independently rate-limits (3 sends per
// email per 15 minutes) — this just keeps the button from being mashed.
const RESEND_COOLDOWN_S = 30;

const OAUTH_STATE_COOKIE = "__dali_oauth_state";

export const meta: Route.MetaFunction = () => [
  { title: "DALI OS · Partner sign in" },
];

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return {};
  if (auth.user.type === "member") return redirect("/");
  if (auth.user.type === "dartmouth") return redirect("/portal");
  const partnerContact = await prisma.partnerContact.findUnique({
    where: { userId: auth.user.sub },
    select: { id: true },
  });
  // A contact row means they've been through at least one auth flow previously;
  // the requirePartnerAccount guard will JIT-provision if anything is missing.
  return redirect(partnerContact ? "/partner" : "/partner/onboarding");
}

export async function action({ request }: Route.ActionArgs) {
  const formData = await request.formData();

  // Google sign-in — works for returning partners AND first-timers (the
  // callback routes unknown verified emails into /partner/onboarding, same
  // destination as the magic link). Same state-cookie shape as /login, minus
  // the @dali.dartmouth.edu hint.
  if (formData.get("provider") === "google") {
    const limited = checkRateLimit(request, { max: 5, windowMs: 60_000 });
    if (limited) return limited;
    const state = randomBytes(32).toString("base64url");
    const secure = getAppEnv() !== "dev";
    const stateCookie = [
      `${OAUTH_STATE_COOKIE}=${state}`,
      "Path=/auth/callback/google",
      "Max-Age=600",
      "HttpOnly",
      "SameSite=Lax",
      ...(secure ? ["Secure"] : []),
    ].join("; ");
    const headers = new Headers();
    headers.append("Set-Cookie", stateCookie);
    headers.set(
      "Location",
      buildGoogleAuthUrl({
        clientId: process.env.GOOGLE_CLIENT_ID!,
        redirectUri: `${getApiBaseUrl()}/auth/callback/google`,
        scopes: ["openid", "email", "profile"],
        state,
      }),
    );
    return new Response(null, { status: 302, headers });
  }

  const email = String(formData.get("email") ?? "");
  if (!email.includes("@")) {
    return { error: "Enter a valid email address" };
  }
  const result = await issuePartnerMagicLink(email, request);
  if ("rateLimited" in result) return result.rateLimited;
  // Identical response whether or not the address maps to an account. Every
  // address does receive an email (a sign-in link, or a use-the-member-login
  // note), so the UI can say "we emailed you" truthfully in all cases.
  return { sent: true, email: normalizeEmail(email) };
}

export default function PartnerLogin() {
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";
  const sent = actionData && "sent" in actionData ? actionData : null;

  // Restart the cooldown on every successful send (each action response is a
  // fresh object), then tick it down once a second.
  const [cooldown, setCooldown] = useState(0);
  useEffect(() => {
    if (sent) setCooldown(RESEND_COOLDOWN_S);
  }, [sent]);
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  return (
    <div className="min-h-screen bg-page flex items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-3">
          <img src="/logo-blue.svg" alt="DALI Lab" className="h-12 w-auto" />
          <span className="font-heading text-2xl font-bold text-dark-blue">
            DALI OS
          </span>
        </div>
        <h1 className="font-heading text-3xl font-bold text-dark-blue mb-2">
          Partner sign in
        </h1>

        {sent ? (
          <div className="mt-6 rounded-2xl bg-brand-tint p-6">
            <p className="font-heading font-semibold text-dark-blue mb-1">
              Check your email
            </p>
            <p className="text-sm text-muted-foreground">
              We sent an email to{" "}
              <span className="font-medium text-dark-blue">{sent.email}</span>.
              Open it and follow the link to continue — sign-in links expire
              in 15 minutes.
            </p>
            <div className="mt-4 flex items-center gap-4 flex-wrap">
              <Form method="post">
                <input type="hidden" name="email" value={sent.email} />
                <button
                  type="submit"
                  disabled={submitting || cooldown > 0}
                  className="text-sm font-medium text-dark-blue hover:underline underline-offset-2 disabled:opacity-50 disabled:no-underline"
                >
                  {cooldown > 0
                    ? `Resend email (${cooldown}s)`
                    : submitting
                      ? "Sending…"
                      : "Resend email"}
                </button>
              </Form>
              <a
                href="/partner/login"
                className="text-sm text-muted-foreground hover:text-foreground"
              >
                Use a different email
              </a>
            </div>
          </div>
        ) : (
          <>
            <p className="text-muted-foreground mb-6">
              Sign in or create your account — no password needed.
            </p>

            {actionData && "error" in actionData && (
              <p className="mb-4 text-sm text-red-600 bg-red-50 rounded-lg px-4 py-3">
                {actionData.error}
              </p>
            )}
            <Form method="post">
              <input type="hidden" name="provider" value="google" />
              <button
                type="submit"
                disabled={submitting}
                className="w-full rounded-xl border border-border bg-card text-dark-blue font-heading font-semibold py-3 hover:border-accent-coral transition disabled:opacity-50"
              >
                Continue with Google
              </button>
            </Form>
            <div className="my-5 flex items-center gap-3">
              <span className="h-px flex-1 bg-border" />
              <span className="text-xs text-muted-foreground">or</span>
              <span className="h-px flex-1 bg-border" />
            </div>
            <Form method="post" className="flex flex-col gap-4">
              <input
                type="email"
                name="email"
                required
                placeholder="you@company.com"
                className="w-full rounded-xl border border-border bg-card px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent-coral"
              />
              <button
                type="submit"
                disabled={submitting}
                className="w-full rounded-xl bg-dark-blue text-white font-heading font-semibold py-3 hover:opacity-90 transition disabled:opacity-50"
              >
                {submitting ? "Sending…" : "Email me a sign-in link"}
              </button>
            </Form>

            {/* The only org-adjacent line that belongs on an auth screen —
                an invite genuinely IS a sign-in method. Everything else about
                organizations lives after sign-in (partner.onboarding). */}
            <p className="mt-6 text-xs text-muted-foreground">
              Have an invite email? It signs you in directly — nothing needed
              here.
            </p>
          </>
        )}

        <p className="mt-10 text-xs text-muted-foreground">
          DALI member or Dartmouth student?{" "}
          <a href="/login" className="underline hover:text-foreground">
            Sign in here
          </a>
        </p>
      </div>
    </div>
  );
}
