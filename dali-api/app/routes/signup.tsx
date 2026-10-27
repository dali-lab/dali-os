import { useEffect, useState, type ReactNode } from "react";
import { Form, Link, redirect, useActionData, useLoaderData, useNavigation, useSearchParams } from "react-router";
import { ArrowLeft, Briefcase, ChevronRight, GraduationCap, Mail, UsersRound, type LucideIcon } from "lucide-react";
import type { Route } from "./+types/signup";
import {
  humanDuration,
  MAGIC_LINK_TTL_SECONDS,
} from "~/email/lib/auth-email";
import { pickSafeLoginNext } from "~/lib/login-next";
import { requireAuth } from "~/lib/auth";
import { auth } from "~/lib/betterauth.server";
import { prisma } from "~/lib/db";
import {
  classifyPartnerEmail,
  normalizeEmail,
} from "~/partners/lib/magic-link.server";
import { sendMemberEmailConflictEmail } from "~/partners/lib/partner-emails.server";
import { isFeatureSwitchedOn } from "~/lib/feature-flags.server";
import AuthShell from "~/components/auth/AuthShell";
import { AuthButton } from "~/components/auth/AuthButton";
import { AuthInput, AuthNotice } from "~/components/auth/v2";
import { cn } from "~/lib/cn";

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

// The door-card subline on the picker.
const DOOR_DESCRIPTIONS: Record<Door, string> = {
  member: "Current lab members",
  dartmouth: "Lab applications, workshops, and more",
  partner: "Working with the lab on a project",
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
  // Already signed in? Hand off to /login, which routes to the right home
  // (member app / onboarding / partner portal / applicant portal).
  const authed = await requireAuth(request);
  if (authed.ok) return redirect("/login");

  const url = new URL(request.url);
  const door = url.searchParams.get("door");
  // Where they were headed before they were asked to sign in — a QR check-in,
  // usually. Without this a scan that leads to account creation ends on the
  // welcome screen and the destination is lost.
  const next = pickSafeLoginNext(url.searchParams.get("next"));
  return {
    door: isValidDoor(door) ? door : null,
    next,
    // Signed-out visitors: the dali.os dress follows the flag's master switch.
    authV2: await isFeatureSwitchedOn("desktop-tabs", request),
  };
}

export async function action({ request }: Route.ActionArgs) {

  const formData = await request.formData();
  const door = String(formData.get("door") ?? "");
  const provider = String(formData.get("provider") ?? "");
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const next = pickSafeLoginNext(
    typeof formData.get("next") === "string" ? (formData.get("next") as string) : null,
  );
  const nextParam = next ? `&next=${encodeURIComponent(next)}` : "";

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
      // Member-conflict guard: a @dali/member email must NOT get a partner magic
      // link — it would sign them into their MEMBER account but land them at the
      // partner door. Send the conflict notice and return the neutral "sent"
      // response WITHOUT issuing a sign-in link (partner.login.tsx does the same).
      const identity = await classifyPartnerEmail(normalizeEmail(email));
      if (identity.kind === "member-conflict") {
        await sendMemberEmailConflictEmail(normalizeEmail(email));
        return { sent: true as const, email: normalizeEmail(email), door };
      }
    }

    const normalized = normalizeEmail(email);

    // Duplicate guard: if this address (or any alias of it) already belongs to
    // an account, sign them into their canonical email instead of sending a
    // signup link — a member's @dartmouth must resolve to their existing @dali
    // account, never spawn a separate student row. Partner keeps its own
    // member-conflict handling above and falls through to the signup send.
    if (door === "member" || door === "dartmouth") {
      const existing = await prisma.user.findFirst({
        where: {
          OR: [
            { email: normalized },
            { daliEmail: normalized },
            { dartmouthEmail: normalized },
            { personalEmail: normalized },
          ],
        },
        select: { email: true },
      });
      if (existing) {
        try {
          await auth.api.signInMagicLink({
            body: {
              email: existing.email ?? normalized,
              callbackURL: next ?? "/",
            },
            headers: request.headers,
          });
        } catch {
          // Swallowed — neutral response in all cases.
        }
        return { sent: true as const, email: normalized, door };
      }
    }

    // Anti-enumeration: always return neutral "sent" response, regardless of
    // whether the address exists or the send succeeds.
    try {
      await auth.api.signInMagicLink({
        body: { email: normalized, callbackURL: `/welcome?door=${door}${nextParam}` },
        headers: request.headers,
      });
    } catch {
      // Swallowed — neutral response in all cases.
    }
    return { sent: true as const, email: normalized, door };
  }

  return redirect(`/signup?door=${door}`);
}

// ── Door picker ───────────────────────────────────────────────────────────────

// dali.os door badges (v2): tinted icon squares, matching the prototype's pairs.
const V2_DOOR_ICONS: Record<Door, { icon: LucideIcon; className: string }> = {
  member: { icon: UsersRound, className: "bg-[#2f6f7a] text-[#d3f3f7]" },
  dartmouth: { icon: GraduationCap, className: "bg-[#5d4a7d] text-[#ece0ff]" },
  partner: { icon: Briefcase, className: "bg-[#7a5a2f] text-[#fbe6c5]" },
};

const V2_LINK = "font-semibold text-os-accent transition-colors duration-150 hover:text-os-accent-hover";

function DoorPicker({ next, v2 = false }: { next: string | null; v2?: boolean }) {
  if (v2) {
    return (
      <>
        <div className="flex flex-col gap-2">
          {VALID_DOORS.map((door, i) => {
            const { icon: Icon, className } = V2_DOOR_ICONS[door];
            return (
              <Link
                key={door}
                to={`/signup?door=${door}${next ? `&next=${encodeURIComponent(next)}` : ""}`}
                style={{ animationDelay: `${60 * i}ms` }}
                className="group flex w-full items-center gap-3 rounded-xl border border-os-container bg-os-card p-3.5 text-left transition-colors duration-150 hover:border-os-container-hi hover:bg-os-card-hover active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-os-accent/40 motion-safe:animate-auth-rise"
              >
                <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg", className)}>
                  <Icon className="h-[18px] w-[18px]" aria-hidden />
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="text-sm font-semibold text-foreground">{DOOR_LABELS[door]}</span>
                  <span className="truncate text-xs text-os-grey">{DOOR_DESCRIPTIONS[door]}</span>
                </span>
                <ChevronRight
                  className="h-4 w-4 shrink-0 text-os-muted transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-foreground"
                  aria-hidden
                />
              </Link>
            );
          })}
        </div>
        <p className="mt-6 text-sm text-os-grey">
          Already have an account?{" "}
          <Link to="/login" className={V2_LINK}>
            Sign in
          </Link>
        </p>
      </>
    );
  }
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
        {doors.map(({ door, label, description, icon }, i) => (
          <Link
            key={door}
            to={`/signup?door=${door}${next ? `&next=${encodeURIComponent(next)}` : ""}`}
            style={{ animationDelay: `${80 + i * 60}ms` }}
            className="w-full flex items-center gap-4 p-5 rounded-2xl border-2 border-transparent bg-brand-tint hover:border-accent-coral transition group text-left motion-safe:animate-auth-rise active:scale-[0.99] duration-150"
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

function DoorSignup({ door, next, actionData, v2 = false }: {
  door: Door;
  next: string | null;
  actionData: Awaited<ReturnType<typeof action>> | undefined;
  v2?: boolean;
}) {
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";

  const sent = actionData && "sent" in actionData && actionData.sent ? actionData : null;
  const formError = actionData && "error" in actionData ? actionData.error : null;

  const [email, setEmail] = useState("");

  // Each rejected submit re-keys the field, re-running the shake animation.
  const [shakeCount, setShakeCount] = useState(0);
  useEffect(() => {
    if (actionData && "error" in actionData && actionData.error) setShakeCount((n) => n + 1);
  }, [actionData]);

  return (
    <>
      <p className={cn("mb-6 -mt-2", v2 ? "text-sm text-os-grey" : "text-muted-foreground")}>
        {DOOR_BLURBS[door]}
      </p>

      {sent ? (
        <div
          key="step-sent"
          className={cn(
            "motion-safe:animate-auth-step",
            v2 ? "rounded-xl border border-os-container bg-os-card p-5" : "rounded-2xl bg-brand-tint p-6",
          )}
        >
          <p className={cn("mb-1 font-semibold", v2 ? "text-foreground" : "font-heading text-dark-blue")}>
            Check your email
          </p>
          <p className={cn("text-sm", v2 ? "leading-relaxed text-os-grey" : "text-muted-foreground")}>
            We sent an email to{" "}
            <span className={cn("font-medium", v2 ? "text-foreground" : "text-dark-blue")}>{sent.email}</span>.
            Open it and follow the link to continue. Sign-in links expire in{" "}
            {humanDuration(MAGIC_LINK_TTL_SECONDS)}.
          </p>
          <div className="mt-4">
            <Link
              to={`/signup?door=${door}${next ? `&next=${encodeURIComponent(next)}` : ""}`}
              className={cn(
                "group inline-flex items-center gap-1.5 text-sm",
                v2 ? V2_LINK : "font-semibold text-dark-blue transition-colors duration-150 hover:text-foreground",
              )}
            >
              <ArrowLeft className="h-4 w-4 transition-transform duration-150 ease-out group-hover:-translate-x-0.5" aria-hidden />
              Use a different email
            </Link>
          </div>
        </div>
      ) : (
        <div key="step-email" className="motion-safe:animate-auth-step">
          {formError &&
            (v2 ? (
              <AuthNotice message={formError} />
            ) : (
              <p role="alert" className="mb-4 text-sm text-red-600 bg-red-50 rounded-lg px-4 py-3 motion-safe:animate-auth-rise">
                {formError}
              </p>
            ))}

          {/* Magic-link signup — one method for every door. We email a sign-in
              link to the verified address; the click lands on /welcome to
              finish setup. The field is controlled so the shake remount can't
              clear what was typed. */}
          <Form method="post" className="flex flex-col gap-3">
            <input type="hidden" name="door" value={door} />
            <input type="hidden" name="provider" value="email-link" />
            {next && <input type="hidden" name="next" value={next} />}
            <div key={`email-${shakeCount}`} className={shakeCount > 0 ? "motion-safe:animate-auth-shake" : undefined}>
              {v2 ? (
                <AuthInput
                  label="Email"
                  type="email"
                  name="email"
                  required
                  placeholder={EMAIL_PLACEHOLDERS[door]}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  aria-invalid={Boolean(formError)}
                />
              ) : (
                <input
                  type="email"
                  name="email"
                  required
                  placeholder={EMAIL_PLACEHOLDERS[door]}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  aria-invalid={Boolean(formError)}
                  className={`w-full rounded-xl border bg-card px-4 py-3 text-sm transition-[border-color] duration-150 focus:outline-none focus:ring-2 focus:ring-accent-coral ${
                    formError ? "border-red-400" : "border-border hover:border-dark-blue/40"
                  }`}
                />
              )}
            </div>
            <AuthButton
              type="submit"
              v2={v2}
              icon={Mail}
              loading={submitting}
              loadingLabel="Sending…"
            >
              Continue with email
            </AuthButton>
          </Form>
        </div>
      )}

      <div className={cn("mt-6 text-sm space-y-1.5", v2 ? "text-os-grey" : "text-center text-muted-foreground")}>
        <p>
          <Link to="/signup" className={v2 ? V2_LINK : "underline hover:text-foreground"}>
            Choose a different account type
          </Link>
        </p>
        <p>
          Already have an account?{" "}
          <Link to="/login" className={v2 ? V2_LINK : "underline hover:text-foreground"}>
            Sign in
          </Link>
        </p>
      </div>
    </>
  );
}

export default function Signup() {
  const { door, next, authV2 } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const [searchParams] = useSearchParams();
  const activeDoor = door ?? (isValidDoor(searchParams.get("door")) ? (searchParams.get("door") as Door) : null);

  return (
    <AuthShell
      heading={activeDoor ? DOOR_LABELS[activeDoor] : "Create your account"}
      v2={authV2}
      stepKey={activeDoor ?? "doors"}
    >
      {activeDoor ? (
        <DoorSignup door={activeDoor} next={next} actionData={actionData} v2={authV2} />
      ) : (
        <DoorPicker next={next} v2={authV2} />
      )}
    </AuthShell>
  );
}
