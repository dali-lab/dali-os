import { Form, redirect, useActionData, useLoaderData, useNavigation } from "react-router";
import type { Route } from "./+types/login.dartmouth.set-password";
import { auth } from "~/lib/betterauth.server";
import { getBetterAuthUser } from "~/lib/betterauth-compat.server";
import { isFeatureEnabledForEveryone } from "~/lib/feature-flags.server";
import { captureDartmouthIdentity } from "~/lib/dartmouth-capture.server";

export const meta: Route.MetaFunction = () => [
  { title: "DALI OS · Set up your account" },
];

export async function loader({ request }: Route.LoaderArgs) {
  const on = await isFeatureEnabledForEveryone("betterauth", request);
  if (!on) return redirect("/login");

  // Require a BetterAuth session — the magic-link callback sets this cookie.
  // No session means the user hasn't verified their email yet.
  const user = await getBetterAuthUser(request);
  if (!user) return redirect("/login/dartmouth");

  return { email: user.email };
}

export async function action({ request }: Route.ActionArgs) {
  const on = await isFeatureEnabledForEveryone("betterauth", request);
  if (!on) return redirect("/login");

  const user = await getBetterAuthUser(request);
  if (!user) return redirect("/login/dartmouth");

  const formData = await request.formData();
  const fullName = String(formData.get("fullName") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");

  if (!fullName) {
    return { error: "Please enter your full name." };
  }
  if (password.length < 8) {
    return { error: "Password must be at least 8 characters." };
  }
  if (password !== confirmPassword) {
    return { error: "Passwords do not match." };
  }

  // Set the password on the BetterAuth account.
  await auth.api.setPassword({
    body: { newPassword: password },
    headers: request.headers,
  });

  // Capture identity: names + dartmouthEmail + netId (best-effort).
  await captureDartmouthIdentity({
    userId: user.sub,
    fullName,
    verifiedEmail: user.email,
  });

  return redirect("/portal");
}

export default function SetPassword() {
  const { email } = useLoaderData<typeof loader>();
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
          Set up your account
        </h1>
        <p className="text-muted-foreground mb-6">
          You're signing in as{" "}
          <span className="font-medium text-dark-blue">{email}</span>.
        </p>

        {actionData && "error" in actionData && (
          <p className="mb-4 text-sm text-red-600 bg-red-50 rounded-lg px-4 py-3">
            {actionData.error}
          </p>
        )}

        <Form method="post" className="flex flex-col gap-4">
          {/* Verified email — display-only, not editable */}
          <div>
            <label className="block text-sm font-medium text-dark-blue mb-1">
              Email
            </label>
            <input
              type="email"
              value={email}
              readOnly
              className="w-full rounded-xl border border-border bg-card/60 px-4 py-3 text-sm text-muted-foreground cursor-not-allowed"
            />
          </div>

          <div>
            <label
              htmlFor="fullName"
              className="block text-sm font-medium text-dark-blue mb-1"
            >
              Full name
            </label>
            <input
              id="fullName"
              type="text"
              name="fullName"
              required
              autoComplete="name"
              placeholder="Ada Lovelace"
              className="w-full rounded-xl border border-border bg-card px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent-coral"
            />
          </div>

          <div>
            <label
              htmlFor="password"
              className="block text-sm font-medium text-dark-blue mb-1"
            >
              Password
            </label>
            <input
              id="password"
              type="password"
              name="password"
              required
              autoComplete="new-password"
              minLength={8}
              placeholder="At least 8 characters"
              className="w-full rounded-xl border border-border bg-card px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent-coral"
            />
          </div>

          <div>
            <label
              htmlFor="confirmPassword"
              className="block text-sm font-medium text-dark-blue mb-1"
            >
              Confirm password
            </label>
            <input
              id="confirmPassword"
              type="password"
              name="confirmPassword"
              required
              autoComplete="new-password"
              placeholder="Re-enter your password"
              className="w-full rounded-xl border border-border bg-card px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent-coral"
            />
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-xl bg-dark-blue text-white font-heading font-semibold py-3 hover:opacity-90 transition disabled:opacity-50 mt-2"
          >
            {submitting ? "Finishing…" : "Finish"}
          </button>
        </Form>
      </div>
    </div>
  );
}
