import { Form, redirect, useActionData, useLoaderData, useNavigation } from "react-router";
import type { Route } from "./+types/welcome";
import { isFeatureEnabledForEveryone } from "~/lib/feature-flags.server";
import { getBetterAuthUser } from "~/lib/betterauth-compat.server";
import { auth } from "~/lib/betterauth.server";
import { captureDartmouthIdentity } from "~/lib/dartmouth-capture.server";
import { prisma } from "~/lib/db";
import AuthShell from "~/components/auth/AuthShell";

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

  // If no valid door, the user ended up here via /login (not /signup).
  // Nothing to set up — send them to the app.
  if (!isValidDoor(doorParam)) return redirect("/");

  const door: Door = doorParam;

  return {
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
  const door = String(formData.get("door") ?? "");
  const intent = String(formData.get("intent") ?? "finish");
  const formFullName = String(formData.get("fullName") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");

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

  // Optional password — only set when intent=finish AND a password was provided.
  if (intent === "finish" && password) {
    if (password.length < 8) {
      return { error: "Password must be at least 8 characters." };
    }
    if (password !== confirmPassword) {
      return { error: "Passwords do not match." };
    }
    await auth.api.setPassword({
      body: { newPassword: password },
      headers: request.headers,
    });
  }
  // intent=skip → skip password entirely.

  return redirect(DOOR_DESTINATIONS[door]);
}

export default function Welcome() {
  const { email, door, needsName } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";

  const actionError = actionData && "error" in actionData ? actionData.error : null;

  return (
    <AuthShell heading="One last thing" error={actionError}>
      <p className="text-muted-foreground mb-6 -mt-2">
        You're signed in as{" "}
        <span className="font-medium text-dark-blue">{email}</span>.
      </p>

      <Form method="post" className="flex flex-col gap-4">
        <input type="hidden" name="door" value={door} />

        {/* Verified email — display-only */}
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

        {needsName && (
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
        )}

        {/* Optional password section */}
        <div className="mt-2">
          <label className="block text-sm font-medium text-dark-blue mb-0.5">
            Set a password <span className="font-normal text-muted-foreground">(optional)</span>
          </label>
          <p className="text-xs text-muted-foreground mb-3">
            Lets you sign in with a password instead of waiting on an emailed
            link. You can always use the link.
          </p>
          <div className="flex flex-col gap-3">
            <input
              id="password"
              type="password"
              name="password"
              autoComplete="new-password"
              placeholder="At least 8 characters"
              className="w-full rounded-xl border border-border bg-card px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent-coral"
            />
            <input
              id="confirmPassword"
              type="password"
              name="confirmPassword"
              autoComplete="new-password"
              placeholder="Re-enter your password"
              className="w-full rounded-xl border border-border bg-card px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent-coral"
            />
          </div>
        </div>

        {/* Submit buttons */}
        <div className="flex flex-col gap-2 mt-2">
          <button
            type="submit"
            name="intent"
            value="finish"
            disabled={submitting}
            className="w-full rounded-xl bg-dark-blue text-white font-heading font-semibold py-3 hover:opacity-90 transition disabled:opacity-50"
          >
            {submitting ? "Finishing…" : "Finish"}
          </button>
          <button
            type="submit"
            name="intent"
            value="skip"
            disabled={submitting}
            className="w-full rounded-xl border border-border bg-card text-dark-blue font-heading font-semibold py-3 hover:border-accent-coral transition disabled:opacity-50"
          >
            Skip for now
          </button>
        </div>
      </Form>
    </AuthShell>
  );
}
