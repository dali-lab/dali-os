import {
  Form,
  redirect,
  useActionData,
  useLoaderData,
  useNavigation,
} from "react-router";
import type { Route } from "./+types/login.reset-password";
import { auth } from "~/lib/betterauth.server";
import { isFeatureEnabledForEveryone } from "~/lib/feature-flags.server";

export const meta: Route.MetaFunction = () => [
  { title: "DALI OS · Reset password" },
];

// BetterAuth emails a link to `${baseURL}/api/auth/reset-password/:token`, whose
// handler validates the token then redirects here (the `callbackURL`) with the
// token on the query string. We render a new-password form and complete the
// reset via auth.api.resetPassword. Flag-gated like the rest of the doors.
export async function loader({ request }: Route.LoaderArgs) {
  const on = await isFeatureEnabledForEveryone("betterauth", request);
  if (!on) return redirect("/login");

  const token = new URL(request.url).searchParams.get("token");
  return { hasToken: Boolean(token), token: token ?? "" };
}

export async function action({ request }: Route.ActionArgs) {
  const on = await isFeatureEnabledForEveryone("betterauth", request);
  if (!on) return redirect("/login");

  const formData = await request.formData();
  const token = String(formData.get("token") ?? "");
  const password = String(formData.get("password") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");

  if (!token) {
    return { error: "This reset link is missing its token. Request a new one." };
  }
  if (password.length < 8) {
    return { error: "Password must be at least 8 characters." };
  }
  if (password !== confirmPassword) {
    return { error: "Passwords do not match." };
  }

  try {
    await auth.api.resetPassword({
      body: { newPassword: password, token },
      headers: request.headers,
    });
  } catch {
    return {
      error:
        "This reset link is invalid or has expired. Request a new one from the sign-in page.",
    };
  }

  return redirect("/login?reset=success");
}

export default function ResetPassword() {
  const { hasToken, token } = useLoaderData<typeof loader>();
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
          Reset your password
        </h1>

        {!hasToken ? (
          <div className="mt-6 rounded-2xl bg-brand-tint p-6">
            <p className="text-sm text-muted-foreground">
              This link is missing its reset token. Head back to{" "}
              <a href="/login" className="underline hover:text-foreground">
                sign in
              </a>{" "}
              and request a new reset email.
            </p>
          </div>
        ) : (
          <>
            <p className="text-muted-foreground mb-6">
              Choose a new password for your account.
            </p>

            {actionData && "error" in actionData && (
              <p className="mb-4 text-sm text-red-600 bg-red-50 rounded-lg px-4 py-3">
                {actionData.error}
              </p>
            )}

            <Form method="post" className="flex flex-col gap-4">
              <input type="hidden" name="token" value={token} />

              <div>
                <label
                  htmlFor="password"
                  className="block text-sm font-medium text-dark-blue mb-1"
                >
                  New password
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
                  Confirm new password
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
                {submitting ? "Resetting…" : "Reset password"}
              </button>
            </Form>
          </>
        )}
      </div>
    </div>
  );
}
