import { useEffect, useState } from "react";
import { Form, redirect, useActionData, useNavigation } from "react-router";
import type { Route } from "./+types/login.dartmouth";
import { auth } from "~/lib/betterauth.server";
import { getBetterAuthUser } from "~/lib/betterauth-compat.server";
import { isFeatureEnabledForEveryone } from "~/lib/feature-flags.server";

// UI resend cooldown — the server independently rate-limits; this prevents
// button-mashing from hammering the magic-link endpoint.
const RESEND_COOLDOWN_S = 30;

export const meta: Route.MetaFunction = () => [
  { title: "DALI OS · Dartmouth sign in" },
];

export async function loader({ request }: Route.LoaderArgs) {
  // Flag gate: door only exists when betterauth is on for everyone.
  const on = await isFeatureEnabledForEveryone("betterauth", request);
  if (!on) return redirect("/login");

  // Redirect already-authenticated users to their home.
  const user = await getBetterAuthUser(request);
  if (user) return redirect("/portal");

  return {};
}

export async function action({ request }: Route.ActionArgs) {
  const on = await isFeatureEnabledForEveryone("betterauth", request);
  if (!on) return redirect("/login");

  const formData = await request.formData();
  const raw = String(formData.get("email") ?? "").trim().toLowerCase();

  // Only @dartmouth.edu addresses are accepted here.
  // @dali.dartmouth.edu is intentionally excluded — members use Google OAuth.
  if (!raw.endsWith("@dartmouth.edu")) {
    return { error: "Use your @dartmouth.edu email address." };
  }

  // Anti-enumeration: return the same "sent" response whether or not the
  // address already exists in our system, to avoid leaking account existence.
  try {
    await auth.api.signInMagicLink({
      body: {
        email: raw,
        callbackURL: "/login/dartmouth/set-password",
      },
      headers: request.headers,
    });
  } catch {
    // Swallowed — neutral response in all cases.
  }

  return { sent: true, email: raw };
}

export default function LoginDartmouth() {
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";
  const sent = actionData && "sent" in actionData ? actionData : null;

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
          Dartmouth sign in
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
              in 5 minutes.
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
                href="/login/dartmouth"
                className="text-sm text-muted-foreground hover:text-foreground"
              >
                Use a different email
              </a>
            </div>
          </div>
        ) : (
          <>
            <p className="text-muted-foreground mb-6">
              Enter your Dartmouth email to receive a sign-in link.
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
                placeholder="you@dartmouth.edu"
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
          </>
        )}

        <p className="mt-10 text-xs text-muted-foreground">
          Not a Dartmouth student?{" "}
          <a href="/login" className="underline hover:text-foreground">
            Back to sign in
          </a>
        </p>
      </div>
    </div>
  );
}
