import { Navigate, redirect } from "react-router";
import type { Route } from "./+types/core.partners.settings";
import { requireAuth, isNonMember } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { prisma } from "~/lib/db";
import { isCore, getActiveCoreCycleTermIds } from "~/lib/roles";
import { listSelectableForms } from "~/projects/lib/form-slots";
import {
  clearApplicationFormBinding,
  getApplicationFormBinding,
  setApplicationFormBinding,
} from "../lib/application-form.server";
import {
  clearSurveyFormBinding,
  getSurveyFormBinding,
  setSurveyFormBinding,
} from "../lib/partner-survey.server";

export const handle = { hideBreadcrumbs: true, areaSubnav: true };

export const meta: Route.MetaFunction = () => [{ title: "Partner settings · DALI OS" }];

const DEFAULT_STALE_DAYS = 14;

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  if (await isNonMember(auth, request)) return redirect("/portal");
  if (!(await isCore(auth.user.sub))) return redirect("/");

  const [settings, cycleTermIds, applicationFormBinding, surveyFormBinding, selectableForms] =
    await Promise.all([
    prisma.partnerCrmSettings.findUnique({
      where: { id: "default" },
      select: { interviewPanelUserIds: true, staleDays: true },
    }),
    getActiveCoreCycleTermIds(request),
    getApplicationFormBinding(),
    getSurveyFormBinding(),
    listSelectableForms(),
  ]);

  const coreMembers =
    cycleTermIds.length > 0
      ? await prisma.coreAssignment.findMany({
          where: { termId: { in: cycleTermIds } },
          select: {
            userId: true,
            user: { select: { firstName: true, lastName: true, daliEmail: true } },
          },
          distinct: ["userId"],
        })
      : [];

  return {
    settings: {
      interviewPanelUserIds: settings?.interviewPanelUserIds ?? [],
      staleDays: settings?.staleDays ?? DEFAULT_STALE_DAYS,
    },
    coreMembers: coreMembers
      .map((a) => ({
        userId: a.userId,
        name:
          [a.user.firstName, a.user.lastName].filter(Boolean).join(" ") ||
          a.user.daliEmail ||
          a.userId,
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    applicationFormBinding,
    surveyFormBinding,
    selectableForms,
  };
}

export async function action({ request }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  if (!(await isCore(auth.user.sub))) {
    return { error: "You don't have permission to edit these settings." };
  }

  const form = await request.formData();
  const intent = form.get("intent") as string;

  if (intent === "settings-save") {
    const interviewPanelUserIds = form.getAll("interviewPanelUserIds") as string[];
    const staleDaysRaw = Number(form.get("staleDays"));
    const staleDays = Number.isFinite(staleDaysRaw) && staleDaysRaw > 0
      ? Math.round(staleDaysRaw)
      : DEFAULT_STALE_DAYS;

    await prisma.partnerCrmSettings.upsert({
      where: { id: "default" },
      create: { id: "default", interviewPanelUserIds, staleDays },
      update: { interviewPanelUserIds, staleDays },
    });
    return { ok: true };
  }

  if (intent === "bind-form") {
    const formId = (form.get("formId") as string | null) ?? "";
    if (!formId) return { error: "Choose a form to bind." };
    const result = await setApplicationFormBinding(formId, auth.user.sub);
    return result.ok ? { ok: true } : { error: result.error };
  }
  if (intent === "clear-form") {
    await clearApplicationFormBinding();
    return { ok: true };
  }

  if (intent === "bind-survey-form") {
    const formId = (form.get("formId") as string | null) ?? "";
    if (!formId) return { error: "Choose a form to bind." };
    const result = await setSurveyFormBinding(formId, auth.user.sub);
    return result.ok ? { ok: true } : { error: result.error };
  }
  if (intent === "clear-survey-form") {
    await clearSurveyFormBinding();
    return { ok: true };
  }

  return { error: "Unknown action." };
}

// Settings live in a modal on the Applications board; this route keeps the
// loader and action that modal fetches from, and sends a direct visit there.
export default function PartnerSettingsRedirect() {
  return <Navigate to="/core/partners?settings=1" replace />;
}
