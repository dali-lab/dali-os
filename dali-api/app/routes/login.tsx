import { randomBytes } from "node:crypto";
import { Form, Link, redirect, useActionData, useLoaderData, useNavigation, useSearchParams } from "react-router";
import type { Route } from "./+types/login";
import { requireAuth } from "~/lib/auth";
import { prisma } from "~/lib/db";
import { checkRateLimit } from "~/lib/rate-limit";
import { getApiBaseUrl, getAppEnv, getCasBaseUrl } from "~/lib/app-env";
import { buildGoogleAuthUrl } from "~/lib/google-oauth";
import {
  pickSafeLoginNext,
  setLoginNextCookie,
} from "~/lib/login-next";
import { isFeatureEnabledForEveryone } from "~/lib/feature-flags.server";
import { auth } from "~/lib/betterauth.server";
import AuthShell from "~/components/auth/AuthShell";

const OAUTH_STATE_COOKIE = "__dali_oauth_state";

const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 60_000;

export const meta: Route.MetaFunction = () => [{ title: "DALI OS · Sign in" }];

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (auth.ok) {
    const url = new URL(request.url);
    const next = pickSafeLoginNext(url.searchParams.get("next"));

    // Route by membership, not by auth.user.type. type is derived from
    // daliEmail alone (auth.ts deriveAuthType), but an accepted member's
    // Workspace provisioning is best-effort — daliEmail can still be null
    // (Workspace unconfigured or the Directory call failed) while they ARE a
    // member. Routing on type in that window would send a member back to the
    // applicant /portal. The DALIMember row is the authoritative signal, so
    // key off it: un-onboarded members go to /onboarding, others to the
    // member app; only genuine non-members fall through to /portal.
    const member = await prisma.dALIMember.findUnique({
      where: { userId: auth.user.sub },
      select: {
        onboardedAt: true,
        // Full-time staff skip the student onboarding flow.
        user: { select: { adminMembership: { select: { isStaff: true } } } },
      },
    });
    if (member) {
      const isStaff = member.user.adminMembership?.isStaff === true;
      if (!(member.onboardedAt || isStaff)) return redirect("/onboarding");
      return redirect(next ?? "/");
    }
    // Signed-in partners land in their portal, not the applicant one.
    const partnerContact = await prisma.partnerContact.findUnique({
      where: { userId: auth.user.sub },
      select: { id: true },
    });
    if (partnerContact) {
      return redirect("/partner");
    }
    return redirect("/portal");
  }

  const betterAuthOn = await isFeatureEnabledForEveryone("betterauth", request);
  return { betterAuthOn };
}

export async function action({ request }: Route.ActionArgs) {
  const limited = checkRateLimit(request, {
    max: RATE_LIMIT_MAX,
    windowMs: RATE_LIMIT_WINDOW_MS,
  });
  if (limited) return limited;

  const formData = await request.formData();
  const provider = formData.get("provider") as string;
  const next = pickSafeLoginNext(
    typeof formData.get("next") === "string"
      ? (formData.get("next") as string)
      : null,
  );

  const state = randomBytes(32).toString("base64url");
  const apiBase = getApiBaseUrl();
  const casBase = getCasBaseUrl();
  const secure = getAppEnv() !== "dev";

  const headers = new Headers();
  if (next) setLoginNextCookie(headers, next);

  // --- BetterAuth-gated branches ---
  // These only handle requests that explicitly target the BetterAuth paths.
  // The flag is checked here so that even if a crafted form posts these values
  // while the flag is off, the action falls through to the legacy handlers.

  if (provider === "google-ba") {
    const betterAuthOn = await isFeatureEnabledForEveryone("betterauth", request);
    if (betterAuthOn) {
      // Member Google sign-in via BetterAuth. BetterAuth handles the OAuth
      // state, cookie, and callback — we just initiate and redirect to its URL.
      const result = await auth.api.signInSocial({
        body: { provider: "google", callbackURL: next ?? "/" },
        headers: request.headers,
      });
      // result.url is always present when callbackURL is set (redirect flow).
      // The union type includes an undefined variant for the token flow, so we
      // assert the string here; if somehow url is missing, a brief error page
      // is preferable to an uncaught runtime crash.
      return redirect(result.url!);
    }
    // Flag off — fall through to legacy google branch below.
  }

  if (provider === "password") {
    const betterAuthOn = await isFeatureEnabledForEveryone("betterauth", request);
    if (betterAuthOn) {
      const email = String(formData.get("email") ?? "").trim().toLowerCase();
      const password = String(formData.get("password") ?? "");
      try {
        // returnHeaders: true → { headers: Headers, response: { token, user, ... } }
        // We forward BetterAuth's Set-Cookie so the session persists.
        const { headers: baHeaders } = await auth.api.signInEmail({
          body: { email, password },
          headers: request.headers,
          returnHeaders: true,
        });
        const responseHeaders = new Headers();
        // Preserve any login-next cookie we already built.
        if (next) setLoginNextCookie(responseHeaders, next);
        // Forward all Set-Cookie headers from BetterAuth (session cookie).
        baHeaders.forEach((value, key) => {
          if (key.toLowerCase() === "set-cookie") {
            responseHeaders.append("Set-Cookie", value);
          }
        });
        return redirect(next ?? "/", { headers: responseHeaders });
      } catch {
        return { error: "Incorrect email or password." };
      }
    }
    // Flag off — fall through (no legacy equivalent; return nothing meaningful).
  }

  // --- Legacy (flag-off) branches ---

  if (provider === "cas") {
    // Dartmouth CAS login — redirect to CAS with service URL pointing to our callback
    const serviceUrl = `${apiBase}/auth/callback/cas`;
    const stateCookie = [
      `${OAUTH_STATE_COOKIE}=${state}`,
      "Path=/auth/callback/cas",
      "Max-Age=600",
      "HttpOnly",
      "SameSite=Lax",
      ...(secure ? ["Secure"] : []),
    ].join("; ");
    headers.append("Set-Cookie", stateCookie);
    headers.set(
      "Location",
      `${casBase}/login?service=${encodeURIComponent(serviceUrl)}`,
    );
    return new Response(null, { status: 302, headers });
  }

  // Google OAuth — redirect to Google with @dali.dartmouth.edu hd hint
  const stateCookie = [
    `${OAUTH_STATE_COOKIE}=${state}`,
    "Path=/auth/callback/google",
    "Max-Age=600",
    "HttpOnly",
    "SameSite=Lax",
    ...(secure ? ["Secure"] : []),
  ].join("; ");
  headers.append("Set-Cookie", stateCookie);

  // The Member button is the only button that posts provider=google, so we
  // always want the @dali.dartmouth.edu hd nudge on Google's account picker.
  // Enforcement of the domain still happens server-side in
  // /auth/callback/google; `hd` is purely a UX hint and not a security
  // boundary.
  const googleAuthUrl = buildGoogleAuthUrl({
    clientId: process.env.GOOGLE_CLIENT_ID!,
    redirectUri: `${apiBase}/auth/callback/google`,
    scopes: ["openid", "email", "profile"],
    state,
  });

  headers.set("Location", `${googleAuthUrl}&hd=dali.dartmouth.edu`);
  return new Response(null, { status: 302, headers });
}

// ── Flag-ON: unified single-column sign-in ────────────────────────────────────

function LoginBetterAuth({ next, actionData }: {
  next: string | null;
  actionData: Awaited<ReturnType<typeof action>> | undefined;
}) {
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";

  const passwordError = actionData && "error" in actionData ? actionData.error : null;

  return (
    <div className="flex flex-col gap-4">
      {/* Continue with Google */}
      <Form method="post">
        <input type="hidden" name="provider" value="google-ba" />
        {next && <input type="hidden" name="next" value={next} />}
        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-xl border border-border bg-card text-dark-blue font-heading font-semibold py-3 hover:border-accent-coral transition disabled:opacity-50"
        >
          Continue with Google
        </button>
      </Form>

      {/* or divider */}
      <div className="flex items-center gap-3">
        <span className="h-px flex-1 bg-border" />
        <span className="text-xs text-muted-foreground">or</span>
        <span className="h-px flex-1 bg-border" />
      </div>

      {passwordError && (
        <p className="text-sm text-red-600 bg-red-50 rounded-lg px-4 py-3">
          {passwordError}
        </p>
      )}

      {/* Email + password. Magic links are for account creation only (/signup),
          not sign-in. "Forgot password?" reuses the same email field via a
          formNoValidate submit, so there's never a second stray email input —
          and it doubles as recovery for anyone who skipped setting a password. */}
      <Form method="post" className="flex flex-col gap-3">
        {next && <input type="hidden" name="next" value={next} />}
        <input
          type="email"
          name="email"
          required
          autoComplete="email"
          placeholder="you@email.com"
          className="w-full rounded-xl border border-border bg-card px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent-coral"
        />
        <input
          type="password"
          name="password"
          required
          autoComplete="current-password"
          placeholder="Password"
          className="w-full rounded-xl border border-border bg-card px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent-coral"
        />
        <button
          type="submit"
          name="provider"
          value="password"
          disabled={submitting}
          className="w-full rounded-xl bg-dark-blue text-white font-heading font-semibold py-3 hover:opacity-90 transition disabled:opacity-50"
        >
          {submitting ? "Signing in…" : "Sign in"}
        </button>
        <div className="flex justify-end">
          <Link
            to="/login/forgot-password"
            className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
          >
            Forgot password?
          </Link>
        </div>
      </Form>

      {/* Crossover to signup */}
      <p className="text-center text-sm text-muted-foreground mt-2">
        New to DALI?{" "}
        <Link to="/signup" className="underline hover:text-foreground">
          Create an account
        </Link>
      </p>
    </div>
  );
}

// ── Flag-OFF: legacy 3-door UI ────────────────────────────────────────────────

function LoginLegacy({ next }: { next: string | null }) {
  return (
    <div className="flex flex-col gap-4">
      {/* DALI Member — legacy Google OAuth */}
      <Form method="post">
        <input type="hidden" name="provider" value="google" />
        {next && <input type="hidden" name="next" value={next} />}
        <button
          type="submit"
          className="w-full flex items-center gap-4 p-5 rounded-2xl border-2 border-transparent bg-brand-tint hover:border-accent-coral transition group text-left"
        >
          <div className="w-10 h-10 rounded-full bg-accent-coral/10 flex items-center justify-center flex-shrink-0">
            <svg
              className="w-5 h-5 text-accent-coral"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z"
              />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <span className="font-heading font-semibold text-dark-blue group-hover:text-accent-coral transition block">
              DALI Member
            </span>
            <span className="text-xs text-muted-foreground mt-0.5 block">
              Current lab members
            </span>
          </div>
          <svg
            className="w-4 h-4 text-muted-foreground group-hover:text-accent-coral transition flex-shrink-0"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 5l7 7-7 7"
            />
          </svg>
        </button>
      </Form>

      {/* Dartmouth Student — CAS */}
      <Form method="post">
        <input type="hidden" name="provider" value="cas" />
        {next && <input type="hidden" name="next" value={next} />}
        <button
          type="submit"
          className="w-full flex items-center gap-4 p-5 rounded-2xl border-2 border-transparent bg-brand-tint hover:border-accent-coral transition group text-left"
        >
          <div className="w-10 h-10 rounded-full bg-card flex items-center justify-center flex-shrink-0 shadow-sm">
            <svg
              className="w-5 h-5 text-dark-blue"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 14l9-5-9-5-9 5 9 5z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 14l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0012 20.055a11.952 11.952 0 00-6.824-2.998 12.078 12.078 0 01.665-6.479L12 14z"
              />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <span className="font-heading font-semibold text-dark-blue group-hover:text-accent-coral transition block">
              Dartmouth Student
            </span>
            <span className="text-xs text-muted-foreground mt-0.5 block">
              Lab applications, workshops, and more
            </span>
          </div>
          <svg
            className="w-4 h-4 text-muted-foreground group-hover:text-accent-coral transition flex-shrink-0"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 5l7 7-7 7"
            />
          </svg>
        </button>
      </Form>

      {/* Partner — magic-link auth on its own page, no OAuth */}
      <a
        href="/partner/login"
        className="w-full flex items-center gap-4 p-5 rounded-2xl border-2 border-transparent bg-brand-tint hover:border-accent-coral transition group text-left"
      >
        <div className="w-10 h-10 rounded-full bg-card flex items-center justify-center flex-shrink-0 shadow-sm">
          <svg
            className="w-5 h-5 text-dark-blue"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
            />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <span className="font-heading font-semibold text-dark-blue group-hover:text-accent-coral transition block">
            Partner
          </span>
          <span className="text-xs text-muted-foreground mt-0.5 block">
            Working with the lab on a project
          </span>
        </div>
        <svg
          className="w-4 h-4 text-muted-foreground group-hover:text-accent-coral transition flex-shrink-0"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M9 5l7 7-7 7"
          />
        </svg>
      </a>
    </div>
  );
}

export default function Login() {
  const loaderData = useLoaderData<typeof loader>();
  const betterAuthOn = loaderData && "betterAuthOn" in loaderData ? loaderData.betterAuthOn : false;
  const actionData = useActionData<typeof action>();
  const [searchParams] = useSearchParams();
  const error = searchParams.get("error");
  const next = pickSafeLoginNext(searchParams.get("next"));

  const errorMessages: Record<string, string> = {
    access_denied:
      "Only @dali.dartmouth.edu accounts are allowed for member login.",
    google_auth_failed: "Google sign-in failed. Please try again.",
    cas_auth_failed: "Dartmouth sign-in failed. Please try again.",
    session_expired: "Session expired. Please try again.",
    server_error: "Something went wrong. Please try again.",
  };

  const urlError = error ? (errorMessages[error] ?? "Sign-in failed. Please try again.") : null;

  if (betterAuthOn) {
    return (
      <AuthShell heading="Sign in to DALI OS" error={urlError}>
        <LoginBetterAuth next={next} actionData={actionData} />
      </AuthShell>
    );
  }

  // Flag-OFF: legacy 3-door layout (kept exactly as before, now uses AuthShell
  // for the chrome so new/old share identical split-panel markup).
  return (
    <AuthShell heading="Continue to DALI OS" error={urlError}>
      <LoginLegacy next={next} />
    </AuthShell>
  );
}
