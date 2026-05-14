import { randomBytes } from "node:crypto";
import { Form, redirect, useSearchParams } from "react-router";
import type { Route } from "./+types/login";
import { requireAuth } from "~/lib/auth";
import { checkRateLimit } from "~/lib/rate-limit";

const OAUTH_STATE_COOKIE = "__dali_oauth_state";

const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 60_000;

export const meta: Route.MetaFunction = () => [{ title: "Sign in · DALI OS" }];

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (auth.ok) {
    // Route based on user type: members go to admin, others to portal
    if (auth.user.type === "member") return redirect("/hiring/reviewer");
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
  const apiBase = process.env.API_BASE_URL ?? "http://localhost:3001";
  const casBase = process.env.CAS_BASE_URL ?? "https://login.dartmouth.edu/cas";

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
      ...(process.env.NODE_ENV === "production" ? ["Secure"] : []),
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
    ...(process.env.NODE_ENV === "production" ? ["Secure"] : []),
  ].join("; ");
  headers.append("Set-Cookie", stateCookie);

  // The Member button is the only button that posts provider=google, so we
  // always want the @dali.dartmouth.edu hd nudge on Google's account picker.
  // Enforcement of the domain still happens server-side in
  // /auth/callback/google; `hd` is purely a UX hint and not a security
  // boundary.
  const googleParams = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: `${apiBase}/auth/callback/google`,
    response_type: "code",
    scope: "openid email profile",
    state,
    hd: "dali.dartmouth.edu",
  });

  headers.set(
    "Location",
    `https://accounts.google.com/o/oauth2/v2/auth?${googleParams}`,
  );
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
    <div className="min-h-screen bg-section-bg flex relative overflow-hidden">
      {/* Decorative blocks along right edge — rotated so original width spans viewport height */}
      <img
        src="/spread-out-blocks.png"
        alt=""
        className="absolute opacity-20 dark:opacity-10 pointer-events-none z-0"
        style={{ top: "50%", right: "-30vh", width: "100vh", transform: "translateY(-50%) rotate(-90deg)" }}
      />
      {/* Left decorative panel */}
      <div className="hidden md:flex w-1/2 min-h-screen bg-[#E8F4FA] dark:bg-card flex-col justify-center px-12 lg:px-16 relative overflow-hidden">
        <div className="relative z-10">
          <h2 className="font-heading text-4xl lg:text-5xl font-bold text-dark-blue leading-tight mb-6">
            Welcome to
            <br />
            <span className="text-accent-coral">DALI Lab</span>
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
      <div className="w-full md:w-1/2 min-h-screen flex items-center justify-center px-6 md:px-12 lg:px-16 bg-section-bg">
        <div className="w-full max-w-sm">
          <h1 className="font-heading text-3xl font-bold text-dark-blue mb-2">
            Sign in
          </h1>
          <p className="text-muted-foreground mb-10">
            Select how you'd like to continue
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
                className="w-full flex items-center gap-4 p-5 rounded-2xl border-2 border-transparent bg-[#E8F4FA] dark:bg-secondary hover:border-accent-coral transition group text-left"
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
                    Current Member
                  </span>
                  <span className="text-xs text-muted-foreground mt-0.5 block">
                    @dali.dartmouth.edu Google account
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
                className="w-full flex items-center gap-4 p-5 rounded-2xl border-2 border-transparent bg-[#E8F4FA] dark:bg-secondary hover:border-accent-coral transition group text-left"
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
                    Applicant
                  </span>
                  <span className="text-xs text-muted-foreground mt-0.5 block">
                    Dartmouth single sign-on
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
          </div>
        </div>
      </div>
    </div>
  );
}

