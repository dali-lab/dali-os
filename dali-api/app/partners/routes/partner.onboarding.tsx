import { useState } from "react";
import { Form, redirect, useLoaderData, useNavigation } from "react-router";
import type { Route } from "./+types/partner.onboarding";
import { prisma } from "~/lib/db";
import { logAuditEvent } from "~/lib/audit";
import { requirePartnerCandidate } from "~/partners/lib/partner-auth.server";

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
    // Invited users arrive with a PartnerUser already attached — they only
    // complete their profile. Self-signup users also create the org.
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
    // Profile-completion mode (invited teammate).
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
    return redirect("/partner");
  }

  const isIndividual = formData.get("isIndividual") === "on";
  const orgName = isIndividual
    ? `${firstName} ${lastName}`
    : String(formData.get("orgName") ?? "").trim();
  const website = String(formData.get("website") ?? "").trim() || null;
  if (!orgName) {
    return { error: "Organization name is required" };
  }

  const partnerUser = await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: auth.user.sub },
      data: { firstName, lastName },
    });
    const org = await tx.partnerOrg.create({
      data: { name: orgName, website, isIndividual },
    });
    const pu = await tx.partnerUser.create({
      data: {
        userId: auth.user.sub,
        partnerOrgId: org.id,
        displayRole,
        authProvider: "MagicLink",
      },
    });
    await tx.partnerOrg.update({
      where: { id: org.id },
      data: { primaryContactId: pu.id },
    });
    return pu;
  });

  await logAuditEvent({
    action: "partner.org.create",
    userId: auth.user.sub,
    targetId: partnerUser.partnerOrgId,
    metadata: { via: "self-signup" },
    request,
  });

  return redirect("/partner");
}

export default function PartnerOnboarding({ actionData }: Route.ComponentProps) {
  const { email, firstName, lastName, existingOrg } =
    useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";
  const error = actionData && "error" in actionData ? actionData.error : null;

  // Org concepts live HERE, not on the auth screens: a signed-in account with
  // no membership either accepts an invite (from DALI or a teammate — the link
  // in the email attaches to this account) or creates a new organization.
  const [creating, setCreating] = useState(false);
  const showForm = Boolean(existingOrg) || creating;

  const inputClass =
    "w-full rounded-xl border border-border bg-card px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent-coral";
  const labelClass = "block text-sm font-medium text-dark-blue mb-1";
  const sectionClass = "font-heading text-sm font-semibold text-dark-blue";

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
              you're not part of an organization yet.
            </>
          )}
        </p>

        {!existingOrg && !creating && (
          <>
            <div className="rounded-2xl bg-brand-tint p-6 mb-6">
              <p className="font-heading font-semibold text-dark-blue mb-1">
                Waiting on an invite?
              </p>
              <p className="text-sm text-muted-foreground">
                If DALI or a teammate invited you, use the link in your
                invitation email — it signs you in and adds you to their
                organization automatically. It lands at{" "}
                <span className="font-medium text-dark-blue">{email}</span>.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="w-full rounded-xl border border-border bg-card text-dark-blue font-heading font-semibold py-3 hover:border-accent-coral transition"
            >
              Create your organization
            </button>
          </>
        )}

        {error && showForm && (
          <p className="mb-4 text-sm text-red-600 bg-red-50 rounded-lg px-4 py-3">
            {error}
          </p>
        )}

        {showForm && (
        <Form method="post" className="flex flex-col gap-5">
          {!existingOrg && <h2 className={sectionClass}>About you</h2>}
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

          {!existingOrg && (
            <>
              <h2 className={`${sectionClass} mt-3`}>Your organization</h2>
              <label className="flex items-center gap-2 text-sm text-dark-blue">
                <input type="checkbox" name="isIndividual" className="rounded" />
                I'm an individual, not an organization
              </label>
              <div>
                <label htmlFor="orgName" className={labelClass}>
                  Organization name
                </label>
                <input
                  id="orgName"
                  name="orgName"
                  placeholder="Acme Corp"
                  className={inputClass}
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Individuals can skip this — we'll use your name.
                </p>
              </div>
              <div>
                <label htmlFor="website" className={labelClass}>
                  Website <span className="text-muted-foreground">(optional)</span>
                </label>
                <input
                  id="website"
                  name="website"
                  type="url"
                  placeholder="https://example.com"
                  className={inputClass}
                />
              </div>
            </>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="mt-2 w-full rounded-xl bg-dark-blue text-white font-heading font-semibold py-3 hover:opacity-90 transition disabled:opacity-50"
          >
            {submitting ? "Saving…" : "Continue"}
          </button>
        </Form>
        )}
      </div>
    </div>
  );
}
