import { useEffect, useState } from "react";
import { Form, Link, redirect, useActionData, useNavigation, useSearchParams } from "react-router";
import type { Route } from "./+types/login";
import { humanDuration, EMAIL_OTP_TTL_SECONDS } from "~/email/lib/auth-email";
import { requireAuth } from "~/lib/auth";
import { prisma } from "~/lib/db";
import {
  pickSafeLoginNext,
  setLoginNextCookie,
} from "~/lib/login-next";
import { resolveLoginIdentifier } from "~/lib/user-email.server";
import { auth } from "~/lib/betterauth.server";
import AuthShell from "~/components/auth/AuthShell";

export const meta: Route.MetaFunction = () => [{ title: "DALI OS · Sign in" }];

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (auth.ok) {
    const url = new URL(request.url);
    const next = pickSafeLoginNext(url.searchParams.get("next"));

    // Route by membership, not by auth.user.type. type is derived from
    // daliEmail alone (auth.ts deriveAuthType), but an accepted member's
    // Workspace provisioning is best-effort — daliEmail can still be null
    // (Workspace unconfigured or the Directory call failed) while they ARE a
    // member. Routing on type in that window would send a member back to the
    // applicant /portal. The DALIMember row is the authoritative signal, so
    // key off it: un-onboarded members go to /onboarding, others to the
    // member app; only genuine non-members fall through to /portal.
    const member = await prisma.dALIMember.findUnique({
      where: { userId: auth.user.sub },
      select: {
        onboardedAt: true,
        // Full-time staff skip the student onboarding flow.
        user: { select: { adminMembership: { select: { isStaff: true } } } },
      },
    });
    if (member) {
      const isStaff = member.user.adminMembership?.isStaff === true;
      if (!(member.onboardedAt || isStaff)) return redirect("/onboarding");
      return redirect(next ?? "/");
    }
    // Signed-in partners land in their portal, not the applicant one.
    const partnerContact = await prisma.partnerContact.findUnique({
      where: { userId: auth.user.sub },
      select: { id: true },
    });
    if (partnerContact) {
      return redirect("/partner");
    }
    return redirect("/portal");
  }

  return null;
}

export async function action({ request }: Route.ActionArgs) {
  const formData = await request.formData();
  const provider = formData.get("provider") as string;
  const next = pickSafeLoginNext(
    typeof formData.get("next") === "string"
      ? (formData.get("next") as string)
      : null,
  );

  // Only code sends are throttled (in BetterAuth's before hook). Verifying a
  // code is not: BetterAuth caps attempts per code, so a user fixing a typo
  // never trips a limit and gets bounced off the code screen.

  if (provider === "email-code") {
    const email = String(formData.get("email") ?? "").trim().toLowerCase();
    if (!email.includes("@")) {
      return { error: "Enter a valid email address." };
    }
    // Resolve an alias (e.g. a member's @dartmouth) to their canonical login
    // email; the code is delivered there. `email` stays the typed address for
    // display so we never reveal the mapping; `identifier` is what verify uses.
    const identifier = await resolveLoginIdentifier(email);
    // Anti-enumeration: always advance to the code screen. The emailOTP plugin
    // has disableSignUp, so a non-existent address silently receives nothing.
    // A throttled send stays on the code screen too, so an earlier code still works.
    try {
      await auth.api.sendVerificationOTP({
        body: { email: identifier, type: "sign-in" },
        headers: request.headers,
      });
    } catch (err) {
      if ((err as { status?: unknown })?.status === "TOO_MANY_REQUESTS") {
        return {
          codeSent: true as const,
          email,
          identifier,
          error:
            "You've requested several codes. Enter the most recent one below, or wait a few minutes to request a new one.",
        };
      }
    }
    return { codeSent: true as const, email, identifier };
  }

  if (provider === "verify-code") {
    // `identifier` is the canonical email the code was sent against;
    // `displayEmail` is the address the user typed, kept only for redisplay so
    // an alias never surfaces the mapping on a wrong-code retry.
    const identifier = String(formData.get("identifier") ?? "").trim().toLowerCase();
    const displayEmail =
      String(formData.get("displayEmail") ?? "").trim().toLowerCase() || identifier;
    const otp = String(formData.get("otp") ?? "").trim();
    try {
      const { headers: baHeaders } = await auth.api.signInEmailOTP({
        body: { email: identifier, otp },
        headers: request.headers,
        returnHeaders: true,
      });
      const responseHeaders = new Headers();
      if (next) setLoginNextCookie(responseHeaders, next);
      baHeaders.forEach((value, key) => {
        if (key.toLowerCase() === "set-cookie") {
          responseHeaders.append("Set-Cookie", value);
        }
      });
      // First-time passkey nudge: route a successful code sign-in through the
      // passkey offer, then on to where they were headed. /welcome gates it —
      // no prompt if they already have a passkey or dismissed the offer.
      const dest = next ?? "/";
      return redirect(
        `/welcome?step=passkey&next=${encodeURIComponent(dest)}`,
        { headers: responseHeaders },
      );
    } catch (err) {
      // Stay on the code screen with an inline message. BetterAuth caps
      // attempts per code (default 3), then deletes the code and throws
      // FORBIDDEN — a dead code can't be retried, so steer them to a new one.
      const exhausted =
        (err as { status?: string } | null)?.status === "FORBIDDEN";
      return {
        codeSent: true as const,
        email: displayEmail,
        identifier,
        error: exhausted
          ? "Too many tries on that code. Request a new one below, then enter it."
          : "That code didn't match. Check it and try again, or request a new one.",
      };
    }
  }

  return redirect("/login");
}

function LoginBetterAuth({ next, actionData }: {
  next: string | null;
  actionData: Awaited<ReturnType<typeof action>> | undefined;
}) {
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";

  const actionError = actionData && "error" in actionData ? actionData.error : null;
  const codeSent =
    actionData && "codeSent" in actionData && actionData.codeSent ? actionData : null;

  const [passkeyError, setPasskeyError] = useState<string | null>(null);
  const [passkeyBusy, setPasskeyBusy] = useState(false);

  async function signInWithPasskey() {
    setPasskeyError(null);
    setPasskeyBusy(true);
    try {
      const { authClient } = await import("~/lib/auth-client");
      const { error } = await authClient.signIn.passkey();
      if (error) {
        setPasskeyError("Couldn't sign in with a passkey. Try again, or use your email.");
        return;
      }
      // Session cookie is set; full reload so every loader sees the new session.
      window.location.href = next ?? "/";
    } catch {
      setPasskeyError("Couldn't sign in with a passkey. Try again, or use your email.");
    } finally {
      setPasskeyBusy(false);
    }
  }

  // Conditional UI: if the platform supports it, silently offer any saved
  // passkey through the email field's autofill — no click needed. Best-effort;
  // unsupported browsers or a dismissed prompt just fall through to the form.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const available =
          typeof PublicKeyCredential !== "undefined" &&
          (await PublicKeyCredential.isConditionalMediationAvailable?.());
        if (!available || cancelled) return;
        const { authClient } = await import("~/lib/auth-client");
        const { error } = await authClient.signIn.passkey({ autoFill: true });
        if (!error && !cancelled) window.location.href = next ?? "/";
      } catch {
        // No conditional mediation / user dismissed — ignore.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [next]);

  // Server sent a code — collect it. A wrong code returns here with an error.
  if (codeSent) {
    return (
      <div className="flex flex-col gap-4">
        {actionError && (
          <p className="text-sm text-red-600 bg-red-50 rounded-lg px-4 py-3">{actionError}</p>
        )}
        {/* Anti-enumeration: we never confirm whether the account exists, so the
            copy is conditional — a real account gets a code, an unknown or
            mistyped address gets nothing but sees the same screen. Honest
            phrasing keeps the no-account case from waiting on a code that will
            never arrive. */}
        <div className="rounded-2xl bg-brand-tint p-4">
          <p className="text-sm text-muted-foreground">
            If there's a DALI OS account for{" "}
            <span className="font-medium text-dark-blue">{codeSent.email}</span>,
            we've emailed a 6-digit code. Enter it below. Codes expire in{" "}
            {humanDuration(EMAIL_OTP_TTL_SECONDS)}.
          </p>
        </div>
        <Form method="post" className="flex flex-col gap-3">
          <input type="hidden" name="provider" value="verify-code" />
          <input type="hidden" name="identifier" value={codeSent.identifier} />
          <input type="hidden" name="displayEmail" value={codeSent.email} />
          {next && <input type="hidden" name="next" value={next} />}
          <input
            type="text"
            name="otp"
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete="one-time-code"
            maxLength={6}
            required
            autoFocus
            placeholder="123456"
            className="w-full rounded-xl border border-border bg-card px-4 py-3 text-center text-lg tracking-[0.4em] focus:outline-none focus:ring-2 focus:ring-accent-coral"
          />
          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-xl bg-dark-blue text-white font-heading font-semibold py-3 hover:opacity-90 transition disabled:opacity-50"
          >
            {submitting ? "Verifying…" : "Verify code"}
          </button>
        </Form>
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <Form method="post">
            <input type="hidden" name="provider" value="email-code" />
            <input type="hidden" name="email" value={codeSent.email} />
            {next && <input type="hidden" name="next" value={next} />}
            <button type="submit" disabled={submitting} className="hover:text-foreground underline underline-offset-2 disabled:opacity-50">
              Resend code
            </button>
          </Form>
          <a href="/login" className="hover:text-foreground">
            Use a different email
          </a>
        </div>
        {/* Shown unconditionally (to real and no-account visitors alike), so it
            gives the no-account case a way forward without confirming existence. */}
        <p className="text-center text-xs text-muted-foreground">
          New to DALI OS?{" "}
          <Link
            to={next ? `/signup?next=${encodeURIComponent(next)}` : "/signup"}
            className="underline hover:text-foreground"
          >
            Create an account
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {(actionError || passkeyError) && (
        <p className="text-sm text-red-600 bg-red-50 rounded-lg px-4 py-3">
          {actionError ?? passkeyError}
        </p>
      )}

      {/* Primary path: enter your email, we send a 6-digit sign-in code. The
          `webauthn` autocomplete token lets a saved passkey surface in this
          field's autofill (the conditional-UI effect above). */}
      <Form method="post" className="flex flex-col gap-3">
        <input type="hidden" name="provider" value="email-code" />
        {next && <input type="hidden" name="next" value={next} />}
        <input
          type="email"
          name="email"
          required
          autoFocus
          autoComplete="username webauthn"
          placeholder="you@email.com"
          className="w-full rounded-xl border border-border bg-card px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent-coral"
        />
        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-xl bg-dark-blue text-white font-heading font-semibold py-3 hover:opacity-90 transition disabled:opacity-50"
        >
          {submitting ? "Sending…" : "Email me a 6-digit code"}
        </button>
      </Form>

      {/* or divider */}
      <div className="flex items-center gap-3">
        <span className="h-px flex-1 bg-border" />
        <span className="text-xs text-muted-foreground">or</span>
        <span className="h-px flex-1 bg-border" />
      </div>

      {/* Passkey — secondary. A discoverable credential needs no email, so a
          returning user signs in with one tap (Face ID / Touch ID / device). */}
      <button
        type="button"
        onClick={() => void signInWithPasskey()}
        disabled={submitting || passkeyBusy}
        className="w-full rounded-xl border border-border bg-card text-dark-blue font-heading font-semibold py-3 hover:border-accent-coral transition disabled:opacity-50"
      >
        {passkeyBusy ? "Waiting for passkey…" : "Sign in with a passkey"}
      </button>

      {/* Crossover to signup */}
      <p className="text-center text-sm text-muted-foreground mt-2">
        New to DALI OS?{" "}
        <Link
          to={next ? `/signup?next=${encodeURIComponent(next)}` : "/signup"}
          className="underline hover:text-foreground"
        >
          Create an account
        </Link>
      </p>
    </div>
  );
}

// ── Flag-OFF: legacy 3-door UI ────────────────────────────────────────────────

export default function Login() {
  const actionData = useActionData<typeof action>();
  const [searchParams] = useSearchParams();
  const error = searchParams.get("error");
  const next = pickSafeLoginNext(searchParams.get("next"));

  const errorMessages: Record<string, string> = {
    access_denied:
      "Only @dali.dartmouth.edu accounts are allowed for member login.",
    google_auth_failed: "Google sign-in failed. Please try again.",
    cas_auth_failed: "Dartmouth sign-in failed. Please try again.",
    session_expired: "Session expired. Please try again.",
    server_error: "Something went wrong. Please try again.",
  };

  const urlError = error ? (errorMessages[error] ?? "Sign-in failed. Please try again.") : null;

  return (
    <AuthShell heading="Sign in to DALI OS" error={urlError}>
      <LoginBetterAuth next={next} actionData={actionData} />
    </AuthShell>
  );
}
