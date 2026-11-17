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
  saveClassAndMajor,
  saveHometown,
  saveWorkSlot,
} from "~/lib/alumni-onboarding.server";
import { listContactEmailOptions, runContactEmailIntent } from "~/lib/contact-email.server";
import { parseAskMeAbout } from "~/lib/alumni-onboarding";
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

  const [data, gameOn, contactEmail] = await Promise.all([
    loadOnboarding(userId),
    isFeatureEnabled("alumni-game", userId, roles, request),
    listContactEmailOptions(userId),
  ]);
  return { ...data, gameOn, contactEmail };
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
  const contact = await runContactEmailIntent(text(form, "intent"), form, userId, request);
  if (contact) return Response.json(contact, { status: "error" in contact ? 400 : 200 });
  try {
    switch (text(form, "intent")) {
      case "save-class":
        await saveClassAndMajor(userId, { classYear: text(form, "classYear"), major: text(form, "major") });
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
          askMeAbout: parseAskMeAbout(text(form, "askMeAbout")),
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
