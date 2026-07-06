// Onboarding IS the "Welcome to DALI! 👋" profile form, rendered INLINE here —
// no cross-URL redirect, so the embedded workspace tab's URL (/onboarding)
// matches its content (avoids the tab-identity race that surfaced other pages).
// Submitting the form writes the member's profile, stamps DALIMember.onboardedAt,
// and clears the onboarding task (see submitMemberForm in public-form.ts).
// Everything else happens in earlier provisioning (DALI email, Slack invite) or
// the later party tour (calendar, app install, MCP). Already-onboarded members
// or non-members are sent home so the form never shows to established members.

import type { Route } from "./+types/onboarding";
import { redirect, useLoaderData } from "react-router";
import { requireAuth } from "~/lib/auth";
import { prisma } from "~/lib/db";
import { loadPublicForm } from "~/forms/lib/public-form";
import {
  MemberFormFillView,
  MemberFormShell,
} from "~/forms/components/MemberFormFillView";
import { NEW_MEMBER_PROFILE_FORM_NAME } from "~/members/lib/profile-form-interpreter";

export const meta: Route.MetaFunction = () => [{ title: "Welcome · DALI OS" }];

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");

  const member = await prisma.dALIMember.findUnique({
    where: { userId: auth.user.sub },
    select: { onboardedAt: true },
  });
  // Only un-onboarded members belong here. Non-members (applicants) go to the
  // applicant portal; already-onboarded members go home. (deriveAuthType never
  // returns "applicant" — the prior type check here was dead code; the
  // DALIMember row is the real member/non-member signal.)
  if (!member) return redirect("/portal");
  if (member.onboardedAt !== null) return redirect("/");

  // Resolve the onboarding form's token, then load it the same way the fill
  // route does so we render an identical form inline (no redirect).
  const profileForm = await prisma.form.findFirst({
    where: { name: NEW_MEMBER_PROFILE_FORM_NAME, published: true },
    orderBy: { createdAt: "desc" },
    select: { publicToken: true },
  });
  const form = profileForm?.publicToken
    ? await loadPublicForm(profileForm.publicToken, auth.user.sub)
    : null;

  return {
    form: form ? { ...form, token: profileForm!.publicToken! } : null,
  };
}

export default function OnboardingPage({ loaderData }: Route.ComponentProps) {
  const { form } = useLoaderData<typeof loader>();
  return (
    <MemberFormShell>
      {form ? (
        <MemberFormFillView data={form} />
      ) : (
        <div className="py-10 text-center">
          <h1 className="font-heading text-xl font-bold text-dark-blue">
            Welcome to DALI!
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Your onboarding form isn't available yet. Please check back shortly,
            or ask a lead if this persists.
          </p>
        </div>
      )}
    </MemberFormShell>
  );
}
