import { Form, redirect, useLoaderData, useNavigation } from "react-router";
import type { Route } from "./+types/partner.onboarding";
import { prisma } from "~/lib/db";
import { requirePartnerCandidate } from "~/partners/lib/partner-auth.server";
import { findOrLinkPartnerContact } from "~/partners/lib/partner-auth.server";
import { useOsShellRoot } from "~/lib/os-shell";
import { buttonClasses } from "~/components/ui/Button";

export const meta: Route.MetaFunction = () => [
  { title: "DALI OS · Partner setup" },
];

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requirePartnerCandidate(request);
  return {
    email: auth.user.email,
    firstName: auth.user.firstName,
    lastName: auth.user.lastName,
  };
}

export async function action({ request }: Route.ActionArgs) {
  const auth = await requirePartnerCandidate(request);
  const formData = await request.formData();
  const firstName = String(formData.get("firstName") ?? "").trim();
  const lastName = String(formData.get("lastName") ?? "").trim();

  if (!firstName || !lastName) {
    return { error: "First and last name are required" };
  }

  const fullName = `${firstName} ${lastName}`;

  // Update the User record with the person's real name, then ensure (or
  // update) the PartnerContact row. No org is created here — orgs are
  // provisioned only at promotion.
  await prisma.user.update({
    where: { id: auth.user.sub },
    data: { firstName, lastName },
  });
  await findOrLinkPartnerContact(auth.user.sub, auth.user.email, fullName);

  return redirect("/partner");
}

export default function PartnerOnboarding({ actionData }: Route.ComponentProps) {
  const { email, firstName, lastName } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";
  const error = actionData && "error" in actionData ? actionData.error : null;

  const labelClass = "os-field-label mb-1.5 block";

  useOsShellRoot(true);

  return (
    <div className="os-shell flex min-h-screen items-center justify-center bg-os-bg px-6 py-12 text-foreground">
      <div className="w-full max-w-md rounded-os-card bg-os-card p-8">
        <span className="font-os-logo text-2xl font-semibold text-os-accent">
          dali.os
        </span>
        <h1 className="font-heading text-3xl font-bold text-foreground mt-6 mb-2">
          You're signed in
        </h1>
        <p className="text-os-grey mb-8">
          as <span className="font-medium text-foreground">{email}</span> —
          tell us your name and you're all set.
        </p>

        {error && (
          <p className="mb-4 text-sm text-destructive bg-destructive/10 rounded-lg px-4 py-3">
            {error}
          </p>
        )}

        <Form method="post" className="os-form flex flex-col gap-5">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="firstName" className={labelClass}>
                First name
              </label>
              <input
                id="firstName"
                name="firstName"
                required
                defaultValue={firstName}
                className="w-full"
              />
            </div>
            <div>
              <label htmlFor="lastName" className={labelClass}>
                Last name
              </label>
              <input
                id="lastName"
                name="lastName"
                required
                defaultValue={lastName}
                className="w-full"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={submitting}
            className={buttonClasses("primary", "md", "mt-2 w-full")}
          >
            {submitting ? "Saving…" : "Continue"}
          </button>
        </Form>
      </div>
    </div>
  );
}
