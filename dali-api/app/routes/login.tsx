import { Form, redirect, useActionData, useSearchParams } from "react-router";
import type { Route } from "./+types/login";
import { auth, requireAuth } from "~/lib/auth";
import { prisma } from "~/lib/db";

export async function loader({ request }: Route.LoaderArgs) {
  const result = await requireAuth(request);
  if (result.ok) {
    const member = await prisma.dALIMember.findFirst({ where: { user: { id: result.user.sub } } });
    if (member) return redirect("/reviewer");
    return redirect("/portal");
  }
  return {};
}

export async function action({ request }: Route.ActionArgs) {
  const formData = await request.formData();
  const email = formData.get("email") as string;
  const password = formData.get("password") as string;

  if (!email || !password) {
    return { error: "Email and password are required" };
  }

  const res = await auth.api.signInEmail({
    body: { email, password },
    asResponse: true,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    return { error: (body as any).message ?? "Invalid email or password" };
  }

  // Forward BetterAuth's Set-Cookie headers and redirect
  const headers = new Headers(res.headers);
  headers.set("Location", "/portal");
  return new Response(null, { status: 302, headers });
}

export default function Login() {
  const actionData = useActionData<typeof action>();
  const [searchParams] = useSearchParams();
  const redirectError = searchParams.get("error");

  const errorMessages: Record<string, string> = {
    unauthorized: "You must be logged in to access that page.",
  };

  const error = actionData?.error ?? (redirectError ? (errorMessages[redirectError] ?? "Sign-in failed. Please try again.") : null);

  return (
    <div className="min-h-screen bg-section-bg flex relative overflow-hidden">
      {/* Left decorative panel */}
      <div className="hidden md:flex w-1/2 min-h-screen bg-[#E8F4FA] flex-col justify-center px-12 lg:px-16 relative">
        <div className="relative z-10">
          <h2 className="font-heading text-4xl lg:text-5xl font-bold text-dark-blue leading-tight mb-6">
            Welcome to
            <br />
            <span className="text-accent-coral">DALI Lab</span>
          </h2>
          <p className="text-dark-blue/70 text-lg leading-relaxed max-w-sm">
            Dartmouth's premier experiential learning lab — where students
            build real products for real partners.
          </p>
        </div>
        <div className="absolute bottom-16 right-8 w-32 h-32 rounded-full bg-accent-teal opacity-30 pointer-events-none" />
        <div className="absolute bottom-32 right-24 w-16 h-16 rounded-full bg-accent-coral opacity-20 pointer-events-none" />
      </div>

      {/* Right form panel */}
      <div className="w-full md:w-1/2 min-h-screen flex items-center justify-center px-6 md:px-12 lg:px-16 bg-section-bg">
        <div className="w-full max-w-sm">
          <h1 className="font-heading text-3xl font-bold text-dark-blue mb-2">
            Sign in
          </h1>
          <p className="text-muted-foreground mb-10">
            Enter your email and password to continue
          </p>

          {error && (
            <p className="mb-6 text-sm text-red-600 bg-red-50 rounded-lg px-4 py-3">
              {error}
            </p>
          )}

          <Form method="post" className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <label htmlFor="email" className="text-sm font-medium text-dark-blue">
                Email
              </label>
              <input
                id="email"
                name="email"
                type="email"
                required
                autoComplete="email"
                className="w-full px-4 py-3 rounded-xl border border-border bg-card focus:outline-none focus:border-accent-coral transition text-dark-blue"
                placeholder="you@example.com"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label htmlFor="password" className="text-sm font-medium text-dark-blue">
                Password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                required
                autoComplete="current-password"
                className="w-full px-4 py-3 rounded-xl border border-border bg-card focus:outline-none focus:border-accent-coral transition text-dark-blue"
                placeholder="••••••••"
              />
            </div>

            <button
              type="submit"
              className="w-full py-3 rounded-xl bg-accent-coral text-white font-semibold hover:bg-accent-coral/90 transition mt-2"
            >
              Sign in
            </button>
          </Form>
        </div>
      </div>
    </div>
  );
}
