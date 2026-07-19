import { randomBytes } from "node:crypto";
import { Form, redirect, useSearchParams } from "react-router";
import type { Route } from "./+types/login";
import { requireAuth } from "~/lib/auth";
import { prisma } from "~/lib/db";
import { checkRateLimit } from "~/lib/rate-limit";
import { getApiBaseUrl, getAppEnv, getCasBaseUrl } from "~/lib/app-env";
import { buildGoogleAuthUrl } from "~/lib/google-oauth";

const OAUTH_STATE_COOKIE = "__dali_oauth_state";

const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 60_000;

export const meta: Route.MetaFunction = () => [{ title: "DALI OS · Sign in" }];

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (auth.ok) {
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
      select: { onboardedAt: true },
    });
    if (member) {
      return redirect(member.onboardedAt ? "/" : "/onboarding");
    }
    // Signed-in partners land in their portal, not the applicant one.
    const partnerUser = await prisma.partnerUser.findUnique({
      where: { userId: auth.user.sub },
      select: { id: true },
    });
    if (partnerUser) {
      return redirect("/partner");
    }
    return redirect("/portal");
  }
  return {};
}

export async function action({ request }: Route.ActionArgs) {
  const limited = checkRateLimit(request, {
    max: RATE_LIMIT_MAX,
    windowMs: RATE_LIMIT_WINDOW_MS,
  });
  if (limited) return limited;

  const formData = await request.formData();
  const provider = formData.get("provider") as string;

  const state = randomBytes(32).toString("base64url");
  const apiBase = getApiBaseUrl();
  const casBase = getCasBaseUrl();
  const secure = getAppEnv() !== "dev";

  const headers = new Headers();

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

export default function Login() {
  const [searchParams] = useSearchParams();
  const error = searchParams.get("error");

  const errorMessages: Record<string, string> = {
    access_denied:
      "Only @dali.dartmouth.edu accounts are allowed for member login.",
    google_auth_failed: "Google sign-in failed. Please try again.",
    cas_auth_failed: "Dartmouth sign-in failed. Please try again.",
    session_expired: "Session expired. Please try again.",
    server_error: "Something went wrong. Please try again.",
  };

  return (
    <div className="min-h-screen bg-page flex relative overflow-hidden">
      {/* Decorative blocks along right edge — rotated so original width spans viewport height */}
      <img
        src="/spread-out-blocks.png"
        alt=""
        className="absolute opacity-20 dark:opacity-10 pointer-events-none z-0"
        style={{
          top: "50%",
          right: "-30vh",
          width: "100vh",
          transform: "translateY(-50%) rotate(-90deg)",
        }}
      />
      {/* Left decorative panel */}
      <div className="hidden md:flex w-1/2 min-h-screen bg-brand-tint flex-col justify-center px-12 lg:px-16 relative overflow-hidden">
        <div className="relative z-10">
          <img
            src="/logo-blue.svg"
            alt="DALI Lab"
            className="h-16 lg:h-20 w-auto mb-10"
          />
          <h2 className="font-heading text-4xl lg:text-5xl font-bold text-dark-blue leading-tight mb-6">
            Welcome to
            <br />
            <span className="text-accent-coral">DALI OS</span>
          </h2>
          <p className="text-dark-blue/70 text-lg leading-relaxed max-w-sm">
            Dartmouth's experiential learning lab — where students build real
            products for real partners.
          </p>
        </div>

        <img
          src="/three-blocks.png"
          alt=""
          className="relative z-10 mt-10 w-64 lg:w-72 dark:opacity-90"
        />
      </div>

      {/* Right form panel */}
      <div className="w-full md:w-1/2 min-h-screen flex items-center justify-center px-6 md:px-12 lg:px-16 bg-page">
        <div className="w-full max-w-sm">
          {/* Mobile-only logo + wordmark (left panel is hidden on small screens) */}
          <div className="md:hidden mb-8 flex items-center gap-3">
            <img
              src="/logo-blue.svg"
              alt="DALI Lab"
              className="h-12 w-auto"
            />
            <span className="font-heading text-2xl font-bold text-dark-blue">
              DALI OS
            </span>
          </div>
          <h1 className="font-heading text-3xl font-bold text-dark-blue mb-2">
            Continue to DALI OS
          </h1>
          <p className="text-muted-foreground mb-10">
            Choose who you are — we'll take you to the right sign-in.
          </p>

          {error && (
            <p className="mb-6 text-sm text-red-600 bg-red-50 rounded-lg px-4 py-3">
              {errorMessages[error] ?? "Sign-in failed. Please try again."}
            </p>
          )}

          <div className="flex flex-col gap-4">
            {/* DALI Member */}
            <Form method="post">
              <input type="hidden" name="provider" value="google" />
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

            {/* Applicant */}
            <Form method="post">
              <input type="hidden" name="provider" value="cas" />
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

          {/* Public policy links. This page doubles as the app's public home
              page for Google OAuth verification, which requires the home page
              to link to the privacy policy. */}
          <footer className="mt-10 flex items-center gap-4 text-xs text-muted-foreground">
            <a href="/privacy" className="hover:text-foreground underline">
              Privacy Policy
            </a>
            <a href="/terms" className="hover:text-foreground underline">
              Terms of Service
            </a>
          </footer>
        </div>
      </div>
    </div>
  );
}
