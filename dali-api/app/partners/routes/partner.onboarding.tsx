import { Form, redirect, useLoaderData, useNavigation } from "react-router";
import type { Route } from "./+types/partner.onboarding";
import { prisma } from "~/lib/db";
import { requirePartnerCandidate } from "~/partners/lib/partner-auth.server";
import { buttonClasses } from "~/components/ui/Button";

export const meta: Route.MetaFunction = () => [
  { title: "DALI OS · Partner setup" },
];

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requirePartnerCandidate(request);
  const partnerUser = await prisma.partnerUser.findUnique({
    where: { userId: auth.user.sub },
    select: { displayRole: true, partnerOrg: { select: { name: true } } },
  });
  return {
    email: auth.user.email,
    firstName: auth.user.firstName,
    lastName: auth.user.lastName,
    // Invited teammates arrive with a PartnerUser already attached (they only
    // complete their profile). Account-first applicants have no org yet — the
    // org is created much later, at project promotion — so onboarding never
    // asks about one.
    existingOrg: partnerUser
      ? { name: partnerUser.partnerOrg.name, displayRole: partnerUser.displayRole }
      : null,
  };
}

export async function action({ request }: Route.ActionArgs) {
  const auth = await requirePartnerCandidate(request);
  const formData = await request.formData();
  const firstName = String(formData.get("firstName") ?? "").trim();
  const lastName = String(formData.get("lastName") ?? "").trim();
  const displayRole = String(formData.get("displayRole") ?? "").trim() || null;

  if (!firstName || !lastName) {
    return { error: "First and last name are required" };
  }

  const existing = await prisma.partnerUser.findUnique({
    where: { userId: auth.user.sub },
    select: { id: true },
  });

  if (existing) {
    // Invited teammate: update name + display role on their org membership.
    await prisma.$transaction([
      prisma.user.update({
        where: { id: auth.user.sub },
        data: { firstName, lastName },
      }),
      prisma.partnerUser.update({
        where: { userId: auth.user.sub },
        data: { displayRole },
      }),
    ]);
  } else {
    // Account-first applicant: just record who they are. No org, no
    // PartnerUser — those are created only if the lab moves forward.
    await prisma.user.update({
      where: { id: auth.user.sub },
      data: { firstName, lastName },
    });
  }

  return redirect("/partner");
}

export default function PartnerOnboarding({ actionData }: Route.ComponentProps) {
  const { email, firstName, lastName, existingOrg } =
    useLoaderData<typeof loader>();
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
          {existingOrg ? `Welcome to ${existingOrg.name}` : "You're signed in"}
        </h1>
        <p className="text-muted-foreground mb-8">
          {existingOrg ? (
            "Tell us who you are and you're all set."
          ) : (
            <>
              as <span className="font-medium text-dark-blue">{email}</span> —
              tell us your name and you can start an application.
            </>
          )}
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

          <div>
            <label htmlFor="displayRole" className={labelClass}>
              Your role <span className="text-muted-foreground">(optional)</span>
            </label>
            <input
              id="displayRole"
              name="displayRole"
              placeholder="e.g. VP Engineering"
              defaultValue={existingOrg?.displayRole ?? ""}
              className={inputClass}
            />
          </div>

          <button
            type="submit"
            disabled={submitting}
            className={buttonClasses("primary", "md", "mt-2 w-full py-3")}
          >
            {submitting ? "Saving…" : "Continue"}
          </button>
        </Form>
      </div>
    </div>
  );
}
