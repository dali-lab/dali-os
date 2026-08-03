import { randomBytes } from "node:crypto";
import { useEffect, useState } from "react";
import { Form, redirect, useActionData, useNavigation } from "react-router";
import { ChevronRight, Mail } from "lucide-react";
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
import { buttonClasses } from "~/components/ui/Button";

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
  // Account-first: /partner works for applicants (no org) too. Onboarding is
  // only needed to capture a name we don't yet have.
  return redirect(auth.user.firstName ? "/partner" : "/partner/onboarding");
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

function GoogleIcon() {
  return (
    <svg className="w-5 h-5" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.06H2.18A10.98 10.98 0 001 12c0 1.78.43 3.46 1.18 4.94l3.66-2.84z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z"
      />
    </svg>
  );
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
    <div className="min-h-screen bg-page flex">
      {/* Brand panel — matches the member /login two-panel layout. */}
      <div className="hidden md:flex w-1/2 min-h-screen bg-brand-tint flex-col justify-center px-12 lg:px-16">
        <img src="/logo-blue.svg" alt="DALI Lab" className="h-16 w-auto mb-10" />
        <h2 className="font-heading text-4xl lg:text-5xl font-bold text-dark-blue leading-tight mb-6">
          Build your idea with <span className="text-accent-coral">DALI</span>
        </h2>
        <p className="text-dark-blue/70 text-lg leading-relaxed max-w-sm">
          Your partner portal — apply, shape the statement of work, sign your
          contract, and follow your project as it comes together.
        </p>
      </div>

      {/* Auth panel */}
      <div className="w-full md:w-1/2 min-h-screen flex items-center justify-center px-6 md:px-12 lg:px-16 bg-page">
      <div className="w-full max-w-sm">
        <div className="md:hidden mb-8 flex items-center gap-3">
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

            {/* Google — the fast path, styled as an option card (matches /login). */}
            <Form method="post">
              <input type="hidden" name="provider" value="google" />
              <button
                type="submit"
                disabled={submitting}
                className="w-full flex items-center gap-4 p-5 rounded-2xl border-2 border-transparent bg-brand-tint hover:border-accent-coral transition group text-left disabled:opacity-50"
              >
                <div className="w-10 h-10 rounded-full bg-card flex items-center justify-center flex-shrink-0 shadow-sm">
                  <GoogleIcon />
                </div>
                <div className="flex-1 min-w-0">
                  <span className="font-heading font-semibold text-dark-blue group-hover:text-accent-coral transition block">
                    Continue with Google
                  </span>
                  <span className="text-xs text-muted-foreground mt-0.5 block">
                    Fastest — use your work Google account
                  </span>
                </div>
                <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-accent-coral transition flex-shrink-0" />
              </button>
            </Form>

            <div className="my-6 flex items-center gap-3">
              <span className="h-px flex-1 bg-border" />
              <span className="text-xs text-muted-foreground">or</span>
              <span className="h-px flex-1 bg-border" />
            </div>

            {/* Magic link — the no-Google fallback. */}
            <Form method="post" className="flex flex-col gap-3">
              <label
                htmlFor="email"
                className="flex items-center gap-2 text-sm font-medium text-dark-blue"
              >
                <Mail className="w-4 h-4 text-muted-foreground" />
                Email me a sign-in link
              </label>
              <input
                id="email"
                type="email"
                name="email"
                required
                placeholder="you@company.com"
                className="w-full rounded-xl border border-border bg-card px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent-coral"
              />
              <button
                type="submit"
                disabled={submitting}
                className={buttonClasses("primary", "md", "w-full py-3")}
              >
                {submitting ? "Sending…" : "Send sign-in link"}
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
    </div>
  );
}
