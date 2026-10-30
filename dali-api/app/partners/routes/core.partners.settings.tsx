import { Navigate, redirect, useSearchParams } from "react-router";
import type { Route } from "./+types/core.partners.settings";
import { requireAuth, isNonMember } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { prisma } from "~/lib/db.server";
import { logAuditEvent } from "~/lib/audit";
import { isCore, getActiveCoreCycleTermIds } from "~/lib/roles";
import { listSelectableForms } from "~/projects/lib/form-slots";
import { setFormPublished } from "~/forms/lib/form-publish.server";
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

    const before = await prisma.partnerCrmSettings.findUnique({
      where: { id: "default" },
      select: { interviewPanelUserIds: true, staleDays: true },
    });
    await prisma.partnerCrmSettings.upsert({
      where: { id: "default" },
      create: { id: "default", interviewPanelUserIds, staleDays },
      update: { interviewPanelUserIds, staleDays },
    });
    await logAuditEvent({
      action: "partner.settings.save",
      userId: auth.user.sub,
      targetId: "default",
      metadata: {
        staleDays: { before: before?.staleDays ?? null, after: staleDays },
        interviewPanelUserIds: { before: before?.interviewPanelUserIds ?? null, after: interviewPanelUserIds },
      },
      request,
    });
    return { ok: true };
  }

  const logBinding = (action: "partner.form-binding.set" | "partner.form-binding.clear", slot: string, formId?: string) =>
    logAuditEvent({
      action,
      userId: auth.user.sub,
      targetId: formId ?? slot,
      metadata: { slot, formId: formId ?? null },
      request,
    });

  if (intent === "bind-form") {
    const formId = (form.get("formId") as string | null) ?? "";
    if (!formId) return { error: "Choose a form to bind." };
    const result = await setApplicationFormBinding(formId, auth.user.sub);
    if (!result.ok) return { error: result.error };
    await logBinding("partner.form-binding.set", "application", formId);
    return { ok: true };
  }
  if (intent === "clear-form") {
    await clearApplicationFormBinding();
    await logBinding("partner.form-binding.clear", "application");
    return { ok: true };
  }

  if (intent === "bind-survey-form") {
    const formId = (form.get("formId") as string | null) ?? "";
    if (!formId) return { error: "Choose a form to bind." };
    const result = await setSurveyFormBinding(formId, auth.user.sub);
    if (!result.ok) return { error: result.error };
    await logBinding("partner.form-binding.set", "survey", formId);
    return { ok: true };
  }
  if (intent === "clear-survey-form") {
    await clearSurveyFormBinding();
    await logBinding("partner.form-binding.clear", "survey");
    return { ok: true };
  }

  if (intent === "set-form-published") {
    const slot = form.get("slot");
    const binding =
      slot === "application"
        ? await getApplicationFormBinding()
        : slot === "survey"
          ? await getSurveyFormBinding()
          : null;
    if (!binding) return { error: "Choose a form first." };
    const result = await setFormPublished(binding.formId, form.get("published") === "1", {
      clearWindow: true,
    });
    if ("error" in result) return { error: result.error };
    return { ok: true };
  }

  return { error: "Unknown action." };
}

// Settings live in a modal on the Applications board; this route keeps the
// loader and action that modal fetches from, and sends a direct visit there.
export default function PartnerSettingsRedirect() {
  const [searchParams] = useSearchParams();
  const next = new URLSearchParams(searchParams);
  next.set("settings", "1");
  return <Navigate to={`/core/partners?${next}`} replace />;
}
