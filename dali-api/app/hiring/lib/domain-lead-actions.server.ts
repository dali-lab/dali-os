import { redirect } from "react-router";
import { setDomainRubric } from "~/hiring/lib/domain-rubric.server";
import { addMentorsToCycleDomain } from "~/hiring/lib/domain-mentors.server";
import { prisma } from "~/lib/db.server";
import { addDomainChallenge, removeDomainChallenge } from "~/hiring/lib/application-form.server";
import { setDomainReady } from "~/hiring/lib/domain-windows.server";

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
  const role = formData.get("role");
  if (role !== "reviewer" && role !== "interviewer") {
    return Response.json({ error: "Unknown role" }, { status: 400 });
  }
  const result = await addMentorsToCycleDomain({
    cycleId: String(formData.get("cycleId") ?? ""),
    domainId,
    role,
    request,
    actorId,
  });
  if (result.status === "not-in-cycle") return Response.json({ error: "That domain isn't in this cycle" }, { status: 400 });
  const notice = {
    added: `Added ${result.added} mentor${result.added === 1 ? "" : "s"}.`,
    already: "Everyone's already on the roster.",
    none: "This domain has no mentors yet.",
  }[result.outcome];
  return { notice };
};

const setRubricAction: DomainLeadActionHandler = async ({ request, formData, domainId, actorId }) => {
  const result = await setDomainRubric({
    cycleId: formData.get("cycleId") as string,
    domainId,
    rubricVersionId: (formData.get("rubricVersionId") as string) || null,
    actorId,
    request,
  });
  if (result === "not-in-cycle") return Response.json({ error: "This domain isn't part of this cycle" }, { status: 409 });
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
