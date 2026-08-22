import { Form, redirect, useLoaderData, useNavigation } from "react-router";
import type { Route } from "./+types/partner.onboarding";
import { prisma } from "~/lib/db";
import { requirePartnerCandidate } from "~/partners/lib/partner-auth.server";
import { findOrLinkPartnerContact } from "~/partners/lib/partner-auth.server";

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

  const inputClass =
    "w-full rounded-xl border border-border bg-card px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent-coral";
  const labelClass = "block text-sm font-medium text-dark-blue mb-1";

  return (
    <div className="min-h-screen bg-page flex items-center justify-center px-6 py-12">
      <div className="w-full max-w-md">
        <div className="mb-8 flex items-center gap-3">
          <img src="/logo-blue.svg" alt="DALI Lab" className="h-12 w-auto" />
          <span className="font-heading text-2xl font-bold text-dark-blue">
            DALI OS
          </span>
        </div>
        <h1 className="font-heading text-3xl font-bold text-dark-blue mb-2">
          You're signed in
        </h1>
        <p className="text-muted-foreground mb-8">
          as <span className="font-medium text-dark-blue">{email}</span> —
          tell us your name and you're all set.
        </p>

        {error && (
          <p className="mb-4 text-sm text-red-600 bg-red-50 rounded-lg px-4 py-3">
            {error}
          </p>
        )}

        <Form method="post" className="flex flex-col gap-5">
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
                className={inputClass}
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
                className={inputClass}
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="mt-2 w-full rounded-xl bg-dark-blue text-white font-heading font-semibold py-3 hover:opacity-90 transition disabled:opacity-50"
          >
            {submitting ? "Saving…" : "Continue"}
          </button>
        </Form>
      </div>
    </div>
  );
}
