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

  if (provider === "google") {
    const result = await auth.api.signInSocial({
      body: { provider: "google", callbackURL: `/welcome?door=${door}` },
      headers: request.headers,
    });
    return redirect(result.url!);
  }

  // Email / magic-link signup
  if (provider === "email-link") {
    // Member door is Google-only (@dali emails are Google accounts) — no
    // magic-link path, even if a request is crafted for it.
    if (door === "member") return redirect(`/signup?door=member`);

    if (door === "dartmouth") {
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
  const doors: { door: Door; label: string; description: string }[] = [
    { door: "member", label: "DALI Lab member", description: "Current lab members" },
    { door: "dartmouth", label: "Dartmouth student", description: "Lab applications, workshops, and more" },
    { door: "partner", label: "Partner", description: "Working with the lab on a project" },
  ];

  return (
    <>
      <div className="flex flex-col gap-4">
        {doors.map(({ door, label, description }) => (
          <Link
            key={door}
            to={`/signup?door=${door}`}
            className="w-full flex items-center gap-4 p-5 rounded-2xl border-2 border-transparent bg-brand-tint hover:border-accent-coral transition group text-left"
          >
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
  // @dali.dartmouth.edu emails are Google accounts, so the member door is
  // Google-only — no magic-link email path.
  const hasEmail = door !== "member";

  return (
    <>
      <p className="text-muted-foreground mb-6 -mt-2">
        {DOOR_BLURBS[door]}
      </p>

      {hasEmail && sent ? (
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

          {/* Continue with Google */}
          <Form method="post" className={hasEmail ? "mb-4" : ""}>
            <input type="hidden" name="door" value={door} />
            <input type="hidden" name="provider" value="google" />
            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-xl border border-border bg-card text-dark-blue font-heading font-semibold py-3 hover:border-accent-coral transition disabled:opacity-50"
            >
              Continue with Google
            </button>
          </Form>

          {/* Email link — omitted on the member door (@dali emails are Google). */}
          {hasEmail && (
            <>
              <div className="flex items-center gap-3 mb-4">
                <span className="h-px flex-1 bg-border" />
                <span className="text-xs text-muted-foreground">or</span>
                <span className="h-px flex-1 bg-border" />
              </div>

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
