import { Form, Link, redirect, useActionData, useNavigation } from "react-router";
import type { Route } from "./+types/login.forgot-password";
import { auth } from "~/lib/betterauth.server";
import { isFeatureEnabledForEveryone } from "~/lib/feature-flags.server";
import AuthShell from "~/components/auth/AuthShell";

export const meta: Route.MetaFunction = () => [
  { title: "DALI OS · Reset your password" },
];

export async function loader({ request }: Route.LoaderArgs) {
  // Flag-OFF: no BetterAuth password reset — send them back to legacy login.
  const on = await isFeatureEnabledForEveryone("betterauth", request);
  if (!on) return redirect("/login");
  return {};
}

export async function action({ request }: Route.ActionArgs) {
  const on = await isFeatureEnabledForEveryone("betterauth", request);
  if (!on) return redirect("/login");

  const formData = await request.formData();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();

  // Anti-enumeration: always return the same neutral "sent" response, whether
  // or not the address exists. The emailed link lands on /login/reset-password.
  try {
    await auth.api.requestPasswordReset({
      body: { email, redirectTo: "/login/reset-password" },
      headers: request.headers,
    });
  } catch {
    // Swallowed — neutral response in all cases.
  }
  return { sent: true, email };
}

export default function ForgotPassword() {
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";
  const sent = actionData && "sent" in actionData ? actionData : null;

  return (
    <AuthShell heading="Reset your password">
      {sent ? (
        <div className="rounded-2xl bg-brand-tint p-6">
          <p className="font-heading font-semibold text-dark-blue mb-1">
            Check your email
          </p>
          <p className="text-sm text-muted-foreground">
            If an account exists for{" "}
            <span className="font-medium text-dark-blue">{sent.email}</span>,
            we sent a link to set a new password. It expires in an hour.
          </p>
          <div className="mt-4">
            <Link
              to="/login"
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              Back to sign in
            </Link>
          </div>
        </div>
      ) : (
        <>
          <p className="text-muted-foreground mb-6 -mt-2">
            Enter your email and we'll send you a link to set a new password.
          </p>
          <Form method="post" className="flex flex-col gap-3">
            <input
              type="email"
              name="email"
              required
              autoComplete="email"
              placeholder="you@email.com"
              className="w-full rounded-xl border border-border bg-card px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent-coral"
            />
            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-xl bg-dark-blue text-white font-heading font-semibold py-3 hover:opacity-90 transition disabled:opacity-50"
            >
              {submitting ? "Sending…" : "Email me a reset link"}
            </button>
          </Form>
          <p className="mt-6 text-center text-sm text-muted-foreground">
            <Link to="/login" className="underline hover:text-foreground">
              Back to sign in
            </Link>
          </p>
        </>
      )}
    </AuthShell>
  );
}
