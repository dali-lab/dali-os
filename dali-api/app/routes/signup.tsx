import type { ReactNode } from "react";
import { Form, Link, redirect, useActionData, useLoaderData, useNavigation, useSearchParams } from "react-router";
import type { Route } from "./+types/signup";
import { isFeatureEnabledForEveryone } from "~/lib/feature-flags.server";
import { requireAuth } from "~/lib/auth";
import { auth } from "~/lib/betterauth.server";
import {
  classifyPartnerEmail,
  normalizeEmail,
} from "~/partners/lib/magic-link.server";
import { sendMemberEmailConflictEmail } from "~/partners/lib/partner-emails.server";
import AuthShell from "~/components/auth/AuthShell";

export const meta: Route.MetaFunction = () => [{ title: "DALI OS · Create account" }];

const VALID_DOORS = ["member", "dartmouth", "partner"] as const;
type Door = (typeof VALID_DOORS)[number];

function isValidDoor(v: unknown): v is Door {
  return VALID_DOORS.includes(v as Door);
}

const DOOR_LABELS: Record<Door, string> = {
  member: "DALI Lab member",
  dartmouth: "Dartmouth student",
  partner: "Partner",
};

// One short line shown on each door's own sign-up page.
const DOOR_BLURBS: Record<Door, string> = {
  member: "For current lab members.",
  dartmouth: "For Dartmouth students.",
  partner: "For organizations working with the lab.",
};

const EMAIL_PLACEHOLDERS: Record<Door, string> = {
  member: "you@dali.dartmouth.edu",
  dartmouth: "you@dartmouth.edu",
  partner: "you@company.com",
};

export async function loader({ request }: Route.LoaderArgs) {
  const on = await isFeatureEnabledForEveryone("betterauth", request);
  // Flag-OFF: no signup — redirect to login.
  if (!on) return redirect("/login");

  // Already signed in? Hand off to /login, which routes to the right home
  // (member app / onboarding / partner portal / applicant portal).
  const authed = await requireAuth(request);
  if (authed.ok) return redirect("/login");

  const url = new URL(request.url);
  const door = url.searchParams.get("door");
  return { door: isValidDoor(door) ? door : null };
}

export async function action({ request }: Route.ActionArgs) {
  const on = await isFeatureEnabledForEveryone("betterauth", request);
  if (!on) return redirect("/login");

  const formData = await request.formData();
  const door = String(formData.get("door") ?? "");
  const provider = String(formData.get("provider") ?? "");
  const email = String(formData.get("email") ?? "").trim().toLowerCase();

  if (!isValidDoor(door)) return redirect("/signup");

  // Email / magic-link signup — the only method on every door now that Google
  // is gone.
  if (provider === "email-link") {
    if (door === "member") {
      if (!email.endsWith("@dali.dartmouth.edu")) {
        return { error: "Use your @dali.dartmouth.edu email address.", door, sent: false as const };
      }
    } else if (door === "dartmouth") {
      if (!email.endsWith("@dartmouth.edu")) {
        return { error: "Use your @dartmouth.edu email address.", door, sent: false as const };
      }
    } else if (door === "partner") {
      // Member-conflict guard: a @dali/member email must NOT get a partner magic link.
      const identity = await classifyPartnerEmail(normalizeEmail(email));
      if (identity.kind === "member-conflict") {
        await sendMemberEmailConflictEmail(normalizeEmail(email));
        // Anti-enumeration: fall through to the neutral "sent" response below.
      } else {
        // proceed
      }
    }

    // Anti-enumeration: always return neutral "sent" response, regardless of
    // whether the address exists or the send succeeds.
    try {
      await auth.api.signInMagicLink({
        body: { email: normalizeEmail(email), callbackURL: `/welcome?door=${door}` },
        headers: request.headers,
      });
    } catch {
      // Swallowed — neutral response in all cases.
    }
    return { sent: true as const, email: normalizeEmail(email), door };
  }

  return redirect(`/signup?door=${door}`);
}

// ── Door picker ───────────────────────────────────────────────────────────────

function DoorPicker() {
  // Door icon badges — matched to the login door cards so "create account" and
  // "sign in" present the same three doors identically.
  const doors: { door: Door; label: string; description: string; icon: ReactNode }[] = [
    {
      door: "member",
      label: "DALI Lab member",
      description: "Current lab members",
      icon: (
        <div className="w-10 h-10 rounded-full bg-accent-coral/10 flex items-center justify-center flex-shrink-0">
          <svg className="w-5 h-5 text-accent-coral" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" />
          </svg>
        </div>
      ),
    },
    {
      door: "dartmouth",
      label: "Dartmouth student",
      description: "Lab applications, workshops, and more",
      icon: (
        <div className="w-10 h-10 rounded-full bg-card flex items-center justify-center flex-shrink-0 shadow-sm">
          <svg className="w-5 h-5 text-dark-blue" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 14l9-5-9-5-9 5 9 5z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 14l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0012 20.055a11.952 11.952 0 00-6.824-2.998 12.078 12.078 0 01.665-6.479L12 14z" />
          </svg>
        </div>
      ),
    },
    {
      door: "partner",
      label: "Partner",
      description: "Working with the lab on a project",
      icon: (
        <div className="w-10 h-10 rounded-full bg-card flex items-center justify-center flex-shrink-0 shadow-sm">
          <svg className="w-5 h-5 text-dark-blue" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
        </div>
      ),
    },
  ];

  return (
    <>
      <div className="flex flex-col gap-4">
        {doors.map(({ door, label, description, icon }) => (
          <Link
            key={door}
            to={`/signup?door=${door}`}
            className="w-full flex items-center gap-4 p-5 rounded-2xl border-2 border-transparent bg-brand-tint hover:border-accent-coral transition group text-left"
          >
            {icon}
            <div className="flex-1 min-w-0">
              <span className="font-heading font-semibold text-dark-blue group-hover:text-accent-coral transition block">
                {label}
              </span>
              <span className="text-xs text-muted-foreground mt-0.5 block">
                {description}
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
          </Link>
        ))}
      </div>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link to="/login" className="underline hover:text-foreground">
          Sign in
        </Link>
      </p>
    </>
  );
}

// ── Per-door signup form ──────────────────────────────────────────────────────

function DoorSignup({ door, actionData }: {
  door: Door;
  actionData: Awaited<ReturnType<typeof action>> | undefined;
}) {
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";

  const sent = actionData && "sent" in actionData && actionData.sent ? actionData : null;
  const formError = actionData && "error" in actionData ? actionData.error : null;

  return (
    <>
      <p className="text-muted-foreground mb-6 -mt-2">
        {DOOR_BLURBS[door]}
      </p>

      {sent ? (
        <div className="rounded-2xl bg-brand-tint p-6">
          <p className="font-heading font-semibold text-dark-blue mb-1">
            Check your email
          </p>
          <p className="text-sm text-muted-foreground">
            We sent an email to{" "}
            <span className="font-medium text-dark-blue">{sent.email}</span>.
            Open it and follow the link to continue. Sign-in links expire in a
            few minutes.
          </p>
          <div className="mt-4">
            <Link
              to={`/signup?door=${door}`}
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              Use a different email
            </Link>
          </div>
        </div>
      ) : (
        <>
          {formError && (
            <p className="mb-4 text-sm text-red-600 bg-red-50 rounded-lg px-4 py-3">
              {formError}
            </p>
          )}

          {/* Magic-link signup — one method for every door. We email a sign-in
              link to the verified address; the click lands on /welcome to
              finish setup. */}
          <Form method="post" className="flex flex-col gap-3">
            <input type="hidden" name="door" value={door} />
            <input type="hidden" name="provider" value="email-link" />
            <input
              type="email"
              name="email"
              required
              placeholder={EMAIL_PLACEHOLDERS[door]}
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
        </>
      )}

      <div className="mt-6 text-center text-sm text-muted-foreground space-y-1.5">
        <p>
          <Link to="/signup" className="underline hover:text-foreground">
            Choose a different account type
          </Link>
        </p>
        <p>
          Already have an account?{" "}
          <Link to="/login" className="underline hover:text-foreground">
            Sign in
          </Link>
        </p>
      </div>
    </>
  );
}

export default function Signup() {
  const { door } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const [searchParams] = useSearchParams();
  const activeDoor = door ?? (isValidDoor(searchParams.get("door")) ? (searchParams.get("door") as Door) : null);

  return (
    <AuthShell
      heading={activeDoor ? DOOR_LABELS[activeDoor] : "Create your account"}
    >
      {activeDoor ? (
        <DoorSignup door={activeDoor} actionData={actionData} />
      ) : (
        <DoorPicker />
      )}
    </AuthShell>
  );
}
