import { useEffect, useState } from "react";
import { Form, redirect, useActionData, useNavigation } from "react-router";
import type { Route } from "./+types/partner.login";
import { requireAuth } from "~/lib/auth";
import { prisma } from "~/lib/db";
import { checkRateLimit } from "~/lib/rate-limit";
import {
  issuePartnerMagicLink,
  normalizeEmail,
  classifyPartnerEmail,
} from "~/partners/lib/magic-link.server";
import { sendMemberEmailConflictEmail } from "~/partners/lib/partner-emails.server";
import { auth } from "~/lib/betterauth.server";
import { isFeatureEnabledForEveryone } from "~/lib/feature-flags.server";

// UI resend cooldown. The server independently rate-limits (3 sends per
// email per 15 minutes) — this just keeps the button from being mashed.
const RESEND_COOLDOWN_S = 30;

export const meta: Route.MetaFunction = () => [
  { title: "DALI OS · Partner sign in" },
];

export async function loader({ request }: Route.LoaderArgs) {
  const betterAuthOn = await isFeatureEnabledForEveryone("betterauth", request);
  const existingAuth = await requireAuth(request);
  if (!existingAuth.ok) {
    // Flag ON: partners sign in on the unified /login screen (email code +
    // passkey), same as members and Dartmouth students. Flag OFF: fall through
    // to the legacy partner magic-link login below. This route stays as a thin
    // flag-gated redirect until cutover cleanup, when it's deleted outright.
    if (betterAuthOn) return redirect("/login");
    return { betterAuthOn };
  }
  if (existingAuth.user.type === "member") return redirect("/");
  if (existingAuth.user.type === "dartmouth") return redirect("/portal");
  const partnerContact = await prisma.partnerContact.findUnique({
    where: { userId: existingAuth.user.sub },
    select: { id: true },
  });
  // A contact row means they've been through at least one auth flow previously;
  // the requirePartnerAccount guard will JIT-provision if anything is missing.
  return redirect(partnerContact ? "/partner" : "/partner/onboarding");
}

export async function action({ request }: Route.ActionArgs) {
  const betterAuthOn = await isFeatureEnabledForEveryone("betterauth", request);
  const formData = await request.formData();

  // Rate-limit every submit (the removed Google branch used to own this). The
  // server also independently throttles magic-link sends per email.
  const limited = checkRateLimit(request, { max: 5, windowMs: 60_000 });
  if (limited) return limited;

  const email = String(formData.get("email") ?? "");
  if (!email.includes("@")) {
    return { error: "Enter a valid email address" };
  }

  if (betterAuthOn) {
    // Member-conflict guard: a @dali/member email must NOT get a partner magic
    // link — it gets the redirect-to-/login conflict email + neutral response.
    const identity = await classifyPartnerEmail(normalizeEmail(email));
    if (identity.kind === "member-conflict") {
      await sendMemberEmailConflictEmail(normalizeEmail(email));
      return { sent: true, email: normalizeEmail(email) };
    }
    // BetterAuth magic-link: callbackURL points to /welcome?door=partner so
    // first-time partners finish setup at the unified welcome page.
    try {
      await auth.api.signInMagicLink({
        body: { email: normalizeEmail(email), callbackURL: "/welcome?door=partner" },
        headers: request.headers,
      });
    } catch {
      // Treat send errors as a neutral outcome — never reveal whether the address
      // is in the system. The member-conflict branch above already handled that case.
    }
    return { sent: true, email: normalizeEmail(email) };
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
                {submitting ? "Sending…" : "Continue with email"}
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
