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
  const { firstName, lastName, existingOrg } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";
  const error = actionData && "error" in actionData ? actionData.error : null;

  // Self-signup asks this FIRST: a teammate whose org already works with the
  // lab must join via invite (Settings → Team) — creating an org here would
  // duplicate it, and many partners share @dartmouth.edu emails so we can't
  // auto-match by domain. Invited users (existingOrg) skip the question.
  const [mode, setMode] = useState<"join" | "create" | null>(
    existingOrg ? "create" : null,
  );

  const inputClass =
    "w-full rounded-xl border border-border bg-card px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent-coral";
  const labelClass = "block text-sm font-medium text-dark-blue mb-1";
  const choiceClass = (selected: boolean) =>
    `w-full rounded-2xl border-2 p-4 text-left transition ${
      selected
        ? "border-accent-coral bg-accent-coral/5"
        : "border-border bg-card hover:border-accent-coral/50"
    }`;

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
          {existingOrg ? `Welcome to ${existingOrg.name}` : "Set up your account"}
        </h1>
        <p className="text-muted-foreground mb-8">
          {existingOrg
            ? "Tell us who you are and you're all set."
            : "First — is your organization already working with the lab?"}
        </p>

        {!existingOrg && (
          <div className="flex flex-col gap-3 mb-8">
            <button
              type="button"
              onClick={() => setMode("join")}
              className={choiceClass(mode === "join")}
            >
              <span className="font-heading font-semibold text-dark-blue block">
                Yes — I'm joining my team
              </span>
              <span className="text-sm text-muted-foreground">
                My organization already has a DALI portal.
              </span>
            </button>
            <button
              type="button"
              onClick={() => setMode("create")}
              className={choiceClass(mode === "create")}
            >
              <span className="font-heading font-semibold text-dark-blue block">
                No — we're new here
              </span>
              <span className="text-sm text-muted-foreground">
                Set up my organization to start working with the lab.
              </span>
            </button>
          </div>
        )}

        {mode === "join" && (
          <div className="rounded-2xl bg-brand-tint p-6">
            <p className="font-heading font-semibold text-dark-blue mb-1">
              Ask a teammate for an invite
            </p>
            <p className="text-sm text-muted-foreground">
              Anyone already in your organization's portal can invite you from{" "}
              <span className="font-medium text-dark-blue">
                Settings → Team → Invite teammate
              </span>
              . The invite arrives by email and connects you to the right
              organization — nothing else to do here. Not sure who has portal
              access? Ask your DALI project contact.
            </p>
          </div>
        )}

        {error && mode === "create" && (
          <p className="mb-4 text-sm text-red-600 bg-red-50 rounded-lg px-4 py-3">
            {error}
          </p>
        )}

        {mode === "create" && (
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

          {!existingOrg && (
            <>
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
