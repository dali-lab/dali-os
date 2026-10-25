import { redirect } from "react-router";
import type { Route } from "./+types/core.partners.plan";
import { requireAuth, isNonMember } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { prisma } from "~/lib/db";
import { logAuditEvent } from "~/lib/audit";
import { isCore, currentTerm } from "~/lib/roles";
import { PartnerCrmNav } from "../components/PartnerCrmNav";
import { PartnerTermPlanner } from "../components/PartnerTermPlanner";
import type { PartnerPlanningStatus } from "../lib/partner-planning";

export const handle = { hideBreadcrumbs: true, areaSubnav: true };

export const meta: Route.MetaFunction = () => [{ title: "Term plan · DALI OS" }];

type DomainOption = { id: string; name: string; hidden: boolean };

type DomainCell = {
  id: string;
  domainId: string;
  expectedMembers: number;
};

export type PlannerRow = {
  applicationId: string;
  targetTermId: string;
  title: string;
  stage: string;
  partnerName: string;
  feeCents: number | null;
  planningStatus: PartnerPlanningStatus | null;
  plannerNotes: string | null;
  plannerTodo: string | null;
  domains: DomainCell[];
};

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  if (await isNonMember(auth, request)) return redirect("/portal");
  if (!(await isCore(auth.user.sub))) return redirect("/");

  const url = new URL(request.url);
  const termParam = url.searchParams.get("term");

  // The planner is a single-term switcher — "all" and "upcoming" don't apply
  // here. Resolve to a specific term id ourselves.
  const [allTerms, currentTermRow] = await Promise.all([
    prisma.term.findMany({
      orderBy: { sortKey: "desc" },
      select: { id: true, code: true, sortKey: true },
    }),
    currentTerm(request),
  ]);
  const selectedTermId =
    allTerms.find((t) => t.id === termParam)?.id ??
    currentTermRow?.id ??
    allTerms[0]?.id ??
    null;

  if (!selectedTermId) {
    return {
      rows: [] as PlannerRow[],
      domains: [] as DomainOption[],
      terms: allTerms.map((t) => ({ id: t.id, code: t.code, isCurrent: t.id === currentTermRow?.id })),
      selectedTermId: null,
    };
  }

  const [targetTerms, allDomains, settings] = await Promise.all([
    prisma.partnerApplicationTargetTerm.findMany({
      where: { termId: selectedTermId },
      select: {
        id: true,
        termId: true,
        planningStatus: true,
        plannerNotes: true,
        plannerTodo: true,
        application: {
          select: {
            id: true,
            title: true,
            stage: true,
            feeCents: true,
            partnerOrg: { select: { name: true } },
            applicantContact: { select: { name: true } },
            domains: {
              select: {
                id: true,
                domainId: true,
                expectedMembers: true,
              },
            },
          },
        },
      },
    }),
    prisma.domain.findMany({
      where: { active: true },
      orderBy: { displayName: "asc" },
      select: { id: true, displayName: true },
    }),
    prisma.partnerCrmSettings.findUnique({
      where: { id: "default" },
      select: { plannerHiddenDomainIds: true },
    }),
  ]);
  const hidden = new Set(settings?.plannerHiddenDomainIds ?? []);

  const rows: PlannerRow[] = targetTerms.map((t) => ({
    applicationId: t.application.id,
    targetTermId: t.id,
    title: t.application.title,
    stage: t.application.stage,
    partnerName:
      t.application.partnerOrg?.name ??
      t.application.applicantContact?.name ??
      "Unknown",
    feeCents: t.application.feeCents,
    planningStatus: t.planningStatus as PartnerPlanningStatus | null,
    plannerNotes: t.plannerNotes,
    plannerTodo: t.plannerTodo,
    domains: t.application.domains,
  }));

  return {
    rows,
    domains: allDomains.map((d) => ({
      id: d.id,
      name: d.displayName,
      hidden: hidden.has(d.id),
    })),
    terms: allTerms.map((t) => ({
      id: t.id,
      code: t.code,
      isCurrent: t.id === currentTermRow?.id,
    })),
    selectedTermId,
  };
}

export async function action({ request }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  if (!(await isCore(auth.user.sub))) {
    return { error: "You don't have permission to edit the term plan." };
  }

  const form = await request.formData();
  if (form.get("intent") !== "set-hidden-domains") {
    return { error: "Unknown action." };
  }
  const plannerHiddenDomainIds = [
    ...new Set((form.getAll("hiddenDomainIds") as string[]).filter(Boolean)),
  ];
  await prisma.partnerCrmSettings.upsert({
    where: { id: "default" },
    create: { id: "default", plannerHiddenDomainIds },
    update: { plannerHiddenDomainIds },
  });
  await logAuditEvent({
    action: "partner.settings.save",
    userId: auth.user.sub,
    targetId: "default",
    metadata: { plannerHiddenDomainIds },
    request,
  });
  return { ok: true };
}

export default function PartnersPlanRoute({ loaderData }: Route.ComponentProps) {
  return (
    <div className="w-full">
      <PartnerCrmNav />
      <PartnerTermPlanner
        rows={loaderData.rows}
        domains={loaderData.domains}
        terms={loaderData.terms}
        selectedTermId={loaderData.selectedTermId}
      />
    </div>
  );
}
