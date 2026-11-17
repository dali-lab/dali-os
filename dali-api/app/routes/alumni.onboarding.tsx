import { redirect, useLoaderData } from "react-router";
import type { Route } from "./+types/alumni.onboarding";
import { requireAuth } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { getUserRoles } from "~/lib/roles";
import { readOnlyRoles } from "~/lib/read-only-roles.server";
import { isFeatureEnabled } from "~/lib/feature-flags.server";
import { BadRequestError } from "~/lib/http-error";
import {
  finishOnboarding,
  loadOnboarding,
  saveAbout,
  saveBasedIn,
  saveHometown,
  savePreferredEmail,
  saveStudy,
  saveWorkSlot,
} from "~/lib/alumni-onboarding.server";
import { reportHistoryCorrection } from "~/lib/alumni-history.server";
import { parseJsonList } from "~/lib/alumni-onboarding";
import { ProfileConflictError, ProfileValidationError } from "~/members/lib/profile-update.server";
import { AlumniOnboarding } from "~/components/alumni-onboarding/AlumniOnboarding";

export const meta: Route.MetaFunction = () => [{ title: "Welcome back · DALI OS" }];

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  const userId = auth.user.sub;
  const roles = await readOnlyRoles(userId, request);
  if (!roles.isAlumni) return redirect("/");
  if (!(await isFeatureEnabled("alumni-onboarding", userId, roles, request))) return redirect("/");

  return loadOnboarding(userId);
}

const text = (form: FormData, key: string) => String(form.get(key) ?? "");
const on = (form: FormData, key: string) => form.get(key) === "on";

export async function action({ request }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return Response.json({ error: "Sign in again to continue." }, { status: 401 });
  const userId = auth.user.sub;
  const roles = await getUserRoles(userId, request);
  if (!roles.isAlumni || !(await isFeatureEnabled("alumni-onboarding", userId, roles, request))) {
    return Response.json({ error: "Not available." }, { status: 403 });
  }

  const form = await request.formData();
  try {
    switch (text(form, "intent")) {
      case "save-class":
        await saveStudy(userId, {
          classYear: text(form, "classYear"),
          majors: parseJsonList(text(form, "majors")),
          minors: parseJsonList(text(form, "minors")),
        });
        break;
      case "save-based-in":
        await saveBasedIn(userId, {
          currentLocation: text(form, "currentLocation"),
          currentLocationGeonameId: text(form, "currentLocationGeonameId"),
        });
        break;
      case "save-email":
        await savePreferredEmail(userId, text(form, "email"));
        break;
      case "report-history":
        if (text(form, "note").trim() === "") throw new BadRequestError("The note is empty.");
        await reportHistoryCorrection(userId, text(form, "note"));
        break;
      case "save-hometown":
        await saveHometown(userId, text(form, "hometown"));
        break;
      case "save-work": {
        const slot = text(form, "slot");
        if (slot !== "now" && slot !== "before") throw new BadRequestError("Unknown job.");
        await saveWorkSlot(userId, {
          slot,
          id: text(form, "id"),
          position: text(form, "position"),
          company: text(form, "company"),
          year: text(form, "year"),
        });
        break;
      }
      case "save-about":
        await saveAbout(userId, {
          funFact: text(form, "funFact"),
          outsideOfWork: text(form, "outsideOfWork"),
          askMeAbout: parseJsonList(text(form, "askMeAbout")),
          linkedinUrl: text(form, "linkedinUrl"),
          personalSite: text(form, "personalSite"),
          birthday: text(form, "birthday"),
          dietaryRestrictions: text(form, "dietaryRestrictions"),
        });
        break;
      case "finish":
        await finishOnboarding(userId, {
          coffeeChats: on(form, "coffeeChats"),
          resumeReviews: on(form, "resumeReviews"),
          partnerReferrals: on(form, "partnerReferrals"),
          mentoring: on(form, "mentoring"),
          speaking: on(form, "speaking"),
        });
        break;
      default:
        return Response.json({ error: "Unknown action." }, { status: 400 });
    }
  } catch (e) {
    if (e instanceof BadRequestError || e instanceof ProfileValidationError || e instanceof ProfileConflictError) {
      return Response.json({ error: e.message }, { status: 400 });
    }
    throw e;
  }
  return Response.json({ ok: true });
}

export default function AlumniOnboardingRoute() {
  const data = useLoaderData<typeof loader>();
  return <AlumniOnboarding data={data} />;
}
