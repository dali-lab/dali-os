import { redirect } from "react-router";
import { prisma } from "~/lib/db.server";
import { addDomainChallenge, removeDomainChallenge } from "~/hiring/lib/application-form.server";
import { logAuditEvent } from "~/lib/audit";
import { setDomainReady } from "~/hiring/lib/domain-windows.server";
import { addDomainMentors, domainMentorIds } from "~/hiring/lib/cycle-rosters.server";

export interface DomainLeadActionContext {
  request: Request;
  formData: FormData;
  domainId: string;
  actorId: string;
}

export type DomainLeadActionHandler = (ctx: DomainLeadActionContext) => Promise<Response | { notice: string } | { error: string }>;

const DASHBOARD = "/hiring/domain-lead";

export async function resolveLeadDomain(formData: FormData, userId: string): Promise<string | null> {
  const intent = formData.get("intent");
  const domainId =
    intent === "remove-challenge-form"
      ? (await prisma.cycleDomainForm.findUnique({
          where: { id: String(formData.get("cdfId") ?? "") },
          select: { domainId: true },
        }))?.domainId
      : String(formData.get("domainId") ?? "");
  if (!domainId) return null;
  const lead = await prisma.domainLeadAssignment.findFirst({ where: { userId, domainId }, select: { id: true } });
  return lead ? domainId : null;
}

const addDomainMentorsAction: DomainLeadActionHandler = async ({ request, formData, domainId, actorId }) => {
  const cycleId = String(formData.get("cycleId") ?? "");
  const role = formData.get("role");
  if (role !== "reviewer" && role !== "interviewer") {
    return Response.json({ error: "Unknown role" }, { status: 400 });
  }
  const linked = await prisma.domainApplicationCycle.findUnique({
    where: { domainId_applicationCycleId: { domainId, applicationCycleId: cycleId } },
    select: { domainId: true },
  });
  if (!linked) return Response.json({ error: "That domain isn't in this cycle" }, { status: 400 });
  const added = await addDomainMentors(cycleId, domainId, role, request, undefined, actorId);
  const notice =
    added > 0
      ? `Added ${added} mentor${added === 1 ? "" : "s"}.`
      : (await domainMentorIds(domainId, request)).length
        ? "Everyone's already on the roster."
        : "This domain has no mentors yet.";
  return { notice };
};

const setRubricAction: DomainLeadActionHandler = async ({ request, formData, domainId, actorId }) => {
  const cycleId = formData.get("cycleId") as string;
  const rubricVersionId = (formData.get("rubricVersionId") as string) || null;

  const hasAssignedReviews = await prisma.applicationReview.count({
    where: { domainApplication: { domainId, application: { applicationCycleId: cycleId } } },
  });
  if (hasAssignedReviews > 0) return redirect(DASHBOARD);

  const rubricKey = { domainId_applicationCycleId: { domainId, applicationCycleId: cycleId } };
  const before = await prisma.domainApplicationCycle.findUnique({
    where: rubricKey,
    select: { rubricVersionId: true },
  });
  await prisma.domainApplicationCycle.update({ where: rubricKey, data: { rubricVersionId } });
  await logAuditEvent({
    action: "domain.rubric.set",
    userId: actorId,
    targetId: domainId,
    metadata: { cycleId, before: before?.rubricVersionId ?? null, after: rubricVersionId },
    request,
  });
  return redirect(DASHBOARD);
};

const createChallengeFormAction: DomainLeadActionHandler = async ({ request, formData, domainId, actorId }) => {
  await addDomainChallenge(
    formData.get("cycleId") as string,
    domainId,
    actorId,
    (formData.get("formId") as string) || null,
    request,
  );
  return redirect(DASHBOARD);
};

const removeChallengeFormAction: DomainLeadActionHandler = async ({ request, formData, actorId }) => {
  await removeDomainChallenge(formData.get("cdfId") as string, undefined, { actorId, request });
  return redirect(DASHBOARD);
};

const markReadyAction: DomainLeadActionHandler = async ({ request, formData, domainId, actorId }) => {
  const cycleId = formData.get("cycleId") as string;
  const ready = formData.get("intent") === "mark-ready";
  const refused = await setDomainReady(cycleId, domainId, ready, { actorId, request });
  if (refused) return { error: refused };
  return redirect(DASHBOARD);
};

export const DOMAIN_LEAD_ACTIONS: Record<string, DomainLeadActionHandler> = {
  "add-domain-mentors": addDomainMentorsAction,
  "set-rubric": setRubricAction,
  "create-challenge-form": createChallengeFormAction,
  "remove-challenge-form": removeChallengeFormAction,
  "mark-ready": markReadyAction,
  "unmark-ready": markReadyAction,
};
