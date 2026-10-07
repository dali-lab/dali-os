import { useEffect, useState } from "react";
import { Form, redirect, useActionData, useLoaderData, useNavigation } from "react-router";
import type { Route } from "./+types/welcome";
import { isFeatureEnabledForEveryone } from "~/lib/feature-flags.server";
import { getBetterAuthUser } from "~/lib/betterauth-compat.server";
import { captureDartmouthIdentity } from "~/lib/dartmouth-capture.server";
import { pickSafeLoginNext } from "~/lib/login-next";
import { shouldOfferPasskey, setPasskeyPromptDismissed } from "~/lib/passkey-prompt.server";
import { prisma } from "~/lib/db";
import AuthShell from "~/components/auth/AuthShell";
import { buttonClasses } from "~/components/ui/Button";

export const meta: Route.MetaFunction = () => [{ title: "DALI OS · Finish setup" }];

const VALID_DOORS = ["member", "dartmouth", "partner"] as const;
type Door = (typeof VALID_DOORS)[number];

function isValidDoor(v: unknown): v is Door {
  return VALID_DOORS.includes(v as Door);
}

const DOOR_DESTINATIONS: Record<Door, string> = {
  member: "/",
  dartmouth: "/portal",
  partner: "/partner",
};

export async function loader({ request }: Route.LoaderArgs) {
  const on = await isFeatureEnabledForEveryone("betterauth", request);
  if (!on) return redirect("/login");

  const user = await getBetterAuthUser(request);
  if (!user) return redirect("/login");

  const url = new URL(request.url);
  const doorParam = url.searchParams.get("door");

  // The passkey offer is reached two ways: post-signup (carries ?door=) and
  // first-time post-login (carries ?next=). Handle it before the door guard,
  // since the login path has no door. Right after the first sign-in is the
  // highest-converting moment to enroll one (eBay: ~75% of enrollments here).
  if (url.searchParams.get("step") === "passkey") {
    // An explicit `next` wins over the door's default landing page. The door
    // says which kind of account this is; `next` says where the person was
    // actually going when they were interrupted — a QR check-in, typically.
    // Preferring the door here is what dropped that destination on the signup
    // path, so someone who scanned a session code finished onboarding and
    // landed on a home page instead of the check-in they came for.
    const destination =
      pickSafeLoginNext(url.searchParams.get("next")) ??
      (isValidDoor(doorParam) ? DOOR_DESTINATIONS[doorParam] : "/");
    // Don't nag: skip if they already have a passkey or dismissed the offer on
    // this device — straight to where they were headed.
    if (!(await shouldOfferPasskey(request, user.sub))) {
      return redirect(destination);
    }
    return { step: "passkey" as const, destination };
  }

  // The setup step is the signup flow only, so it requires a valid door.
  if (!isValidDoor(doorParam)) return redirect("/");
  const door: Door = doorParam;

  return {
    step: "setup" as const,
    email: user.email,
    door,
    // Magic-link signups arrive without a name (no Google to supply one), so
    // ask for it when the session user has no firstName yet.
    needsName: !user.firstName,
  };
}

export async function action({ request }: Route.ActionArgs) {
  const on = await isFeatureEnabledForEveryone("betterauth", request);
  if (!on) return redirect("/login");

  const user = await getBetterAuthUser(request);
  if (!user) return redirect("/login");

  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");

  // "Not now" on the passkey offer — remember the dismissal on this device so we
  // don't re-prompt on the next login, then continue where they were headed.
  if (intent === "dismiss-passkey") {
    const headers = new Headers();
    setPasskeyPromptDismissed(headers);
    const dest = pickSafeLoginNext(String(formData.get("next") ?? "")) ?? "/";
    return redirect(dest, { headers });
  }

  const door = String(formData.get("door") ?? "");
  const formFullName = String(formData.get("fullName") ?? "").trim();

  if (!isValidDoor(door)) return redirect("/");

  // Resolve display name: use what the form sent, or reconstruct from session.
  const resolvedName =
    formFullName ||
    [user.firstName, user.lastName].filter(Boolean).join(" ").trim();

  // needsName is true when there is no firstName on the session user.
  const needsName = !user.firstName;
  if (!resolvedName && needsName) {
    return { error: "Please enter your full name." };
  }

  // Door-specific provisioning — defensive (door is not a security boundary;
  // the email domain is the actual guard).
  if (door === "member") {
    // The create.after hook already provisioned DALIMember for @dali emails.
    // If firstName/lastName are still blank (magic-link signup), fill them in.
    if (!user.firstName && resolvedName) {
      const spaceIdx = resolvedName.indexOf(" ");
      const firstName = spaceIdx === -1 ? resolvedName : resolvedName.slice(0, spaceIdx);
      const lastName = spaceIdx === -1 ? "" : resolvedName.slice(spaceIdx + 1).trim();
      if (user.email.endsWith("@dali.dartmouth.edu")) {
        await prisma.user.update({
          where: { id: user.sub },
          data: { firstName, lastName },
        });
      }
    }
  } else if (door === "dartmouth") {
    // Only provision if the verified email is actually @dartmouth.edu.
    if (!user.email.endsWith("@dartmouth.edu")) {
      return { error: "Please sign in with your Dartmouth (@dartmouth.edu) account." };
    }
    await captureDartmouthIdentity({
      userId: user.sub,
      fullName: resolvedName,
      verifiedEmail: user.email,
    });
  } else if (door === "partner") {
    // Partners: persist name only. The partner portal's onboarding guard
    // handles PartnerContact/org provisioning.
    if (!user.firstName && resolvedName) {
      const spaceIdx = resolvedName.indexOf(" ");
      const firstName = spaceIdx === -1 ? resolvedName : resolvedName.slice(0, spaceIdx);
      const lastName = spaceIdx === -1 ? "" : resolvedName.slice(spaceIdx + 1).trim();
      await prisma.user.update({
        where: { id: user.sub },
        data: { firstName, lastName },
      });
    }
  }

  // Setup only captures the name and runs door provisioning — the credential
  // itself is a passkey, offered on the next step.
  return redirect(`/welcome?door=${door}&step=passkey`);
}

export default function Welcome() {
  const data = useLoaderData<typeof loader>();
  if (data.step === "passkey") {
    return <PasskeyStep destination={data.destination} />;
  }
  return <SetupStep email={data.email} door={data.door} needsName={data.needsName} />;
}

function SetupStep({
  email,
  door,
  needsName,
}: {
  email: string;
  door: Door;
  needsName: boolean;
}) {
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";

  const actionError = actionData && "error" in actionData ? actionData.error : null;

  return (
    <AuthShell heading="One last thing" error={actionError}>
      <p className="text-os-grey mb-6 -mt-2">
        You're signed in as{" "}
        <span className="font-medium text-foreground">{email}</span>.
      </p>

      <Form method="post" className="os-form flex flex-col gap-4">
        <input type="hidden" name="door" value={door} />

        {/* Verified email — display-only */}
        <div>
          <label className="os-field-label mb-1.5 block">
            Email
          </label>
          <input
            type="email"
            value={email}
            readOnly
            className="w-full cursor-not-allowed text-os-grey!"
          />
        </div>

        {needsName && (
          <div>
            <label
              htmlFor="fullName"
              className="os-field-label mb-1.5 block"
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
              className="w-full"
            />
          </div>
        )}

        {/* Continue → the passkey offer. Passkeys are the only credential; there
            is no password to set here. */}
        <div className="flex flex-col gap-2 mt-2">
          <button
            type="submit"
            disabled={submitting}
            className={buttonClasses("primary", "md", "w-full")}
          >
            {submitting ? "Saving…" : "Continue"}
          </button>
        </div>
      </Form>
    </AuthShell>
  );
}

// Post-setup passkey offer. Registration is a client-side WebAuthn ceremony via
// the browser BetterAuth client (dynamically imported so it never loads on the
// server). Benefit-framed copy ("sign in faster") outperforms security framing.
function PasskeyStep({ destination }: { destination: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  // No WebAuthn at all → nothing to offer; go straight to the app so this step
  // is never a dead end.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (typeof PublicKeyCredential === "undefined") {
      window.location.href = destination;
      return;
    }
    setReady(true);
  }, [destination]);

  async function setUpPasskey() {
    setBusy(true);
    setError(null);
    try {
      const { authClient } = await import("~/lib/auth-client");
      const { error: err } = await authClient.passkey.addPasskey();
      if (err) {
        setError("Couldn't set up a passkey. You can add one anytime in Settings.");
        return;
      }
      window.location.href = destination;
    } catch {
      setError("Couldn't set up a passkey. You can add one anytime in Settings.");
    } finally {
      setBusy(false);
    }
  }

  // While deciding support (or redirecting), render nothing — avoids a flash of
  // the prompt on browsers that can't do WebAuthn.
  if (!ready) return null;

  return (
    <AuthShell heading="Sign in faster next time" error={error}>
      <p className="text-os-grey mb-6 -mt-2">
        Set up a passkey and next time you can sign in with Face ID, Touch ID, or
        your device — no code or password to type.
      </p>
      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={() => void setUpPasskey()}
          disabled={busy}
          className={buttonClasses("primary", "md", "w-full")}
        >
          {busy ? "Waiting for passkey…" : "Set up a passkey"}
        </button>
        <Form method="post">
          <input type="hidden" name="intent" value="dismiss-passkey" />
          <input type="hidden" name="next" value={destination} />
          <button
            type="submit"
            className={buttonClasses("secondary", "md", "w-full")}
          >
            Not now
          </button>
        </Form>
      </div>
    </AuthShell>
  );
}
