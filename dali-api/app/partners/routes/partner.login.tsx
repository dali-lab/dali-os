import { randomBytes } from "node:crypto";
import { Form, redirect, useActionData, useNavigation } from "react-router";
import type { Route } from "./+types/partner.login";
import { requireAuth } from "~/lib/auth";
import { prisma } from "~/lib/db";
import { checkRateLimit } from "~/lib/rate-limit";
import { getApiBaseUrl } from "~/lib/app-env";
import { buildGoogleAuthUrl } from "~/lib/google-oauth";
import { issuePartnerMagicLink } from "~/partners/lib/magic-link.server";

const OAUTH_STATE_COOKIE = "__dali_oauth_state";
const isProduction = process.env.NODE_ENV === "production";

export const meta: Route.MetaFunction = () => [
  { title: "DALI OS · Partner sign in" },
];

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return {};
  if (auth.user.type === "member") return redirect("/");
  if (auth.user.type === "dartmouth") return redirect("/portal");
  const partnerUser = await prisma.partnerUser.findUnique({
    where: { userId: auth.user.sub },
    select: { id: true },
  });
  return redirect(partnerUser ? "/partner" : "/partner/onboarding");
}

export async function action({ request }: Route.ActionArgs) {
  const formData = await request.formData();

  // Repeat sign-in via Google (spec: convenience only — accounts are never
  // created here; the callback only accepts pre-existing PartnerUsers).
  // Same state-cookie shape as /login, minus the @dali.dartmouth.edu hint.
  if (formData.get("provider") === "google") {
    const limited = checkRateLimit(request, { max: 5, windowMs: 60_000 });
    if (limited) return limited;
    const state = randomBytes(32).toString("base64url");
    const stateCookie = [
      `${OAUTH_STATE_COOKIE}=${state}`,
      "Path=/auth/callback/google",
      "Max-Age=600",
      "HttpOnly",
      "SameSite=Lax",
      ...(isProduction ? ["Secure"] : []),
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
  // Identical response whether or not the address maps to an account.
  return { sent: true };
}

export default function PartnerLogin() {
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";

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

        {actionData && "sent" in actionData ? (
          <div className="mt-6 rounded-2xl bg-brand-tint p-6">
            <p className="font-heading font-semibold text-dark-blue mb-1">
              Check your email
            </p>
            <p className="text-sm text-muted-foreground">
              If that address can sign in here, we sent it a one-time link.
              The link expires in 15 minutes.
            </p>
          </div>
        ) : (
          <>
            <p className="text-muted-foreground mb-8">
              Enter your work email and we'll send you a one-time sign-in
              link. No password needed.
            </p>
            {actionData && "error" in actionData && (
              <p className="mb-4 text-sm text-red-600 bg-red-50 rounded-lg px-4 py-3">
                {actionData.error}
              </p>
            )}
            <Form method="post" className="flex flex-col gap-4">
              <input
                type="email"
                name="email"
                required
                autoFocus
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
            <Form method="post" className="mt-3">
              <input type="hidden" name="provider" value="google" />
              <button
                type="submit"
                disabled={submitting}
                className="w-full rounded-xl border border-border bg-card text-dark-blue font-heading font-semibold py-3 hover:border-accent-coral transition disabled:opacity-50"
              >
                Continue with Google
              </button>
            </Form>
            <p className="mt-2 text-xs text-muted-foreground">
              Google works for returning partners whose account email is a
              Google account. First time here? Use the email link above.
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
