import { redirect } from "react-router";
import { prisma } from "~/lib/db.server";
import { requireAuth } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { getActiveCycleById, getOpenCycles, type ActiveCycle } from "~/hiring/lib/cycles";
import { applicantPortalPath } from "~/hiring/lib/applicant-groups";
import { loadHiringForm } from "~/hiring/lib/application-form.server";
import { listWaitlistedApplications } from "~/hiring/lib/continued-interest.server";
import { loadOfferedStartTerms, offersStartTermChoice } from "~/hiring/lib/start-terms.server";
import { safeParseJsonString } from "~/forms/lib/forms-data";
import { applicantDeadline, domainCloseDate } from "~/hiring/lib/domain-windows";
import { closedDomainIdSet, frozenSelection } from "~/hiring/lib/application-lock.server";
import type { Question } from "~/types";
import { ensureBlocks } from "~/collab/legacy/pm-to-blocknote";
import { normalizeQuestionBodies } from "~/lib/question-blocks.server";


// The Open Students cycle a request is about. An id names one; without one (or
// with an id that isn't an Open Students cycle) the only open cycle is used, or
// the caller offers a choice when several are open.
async function resolveApplyCycle(
  cycleId: string | undefined,
): Promise<{ cycle: ActiveCycle } | { choices: ActiveCycle[] }> {
  if (cycleId) {
    const cycle = await openStudentsCycle(cycleId);
    if (cycle) return { cycle };
  }
  const open = await getOpenCycles({ applicants: "Students" });
  return open.length === 1 ? { cycle: open[0] } : { choices: open };
}

export async function openStudentsCycle(cycleId: string): Promise<ActiveCycle | null> {
  const cycle = await getActiveCycleById(cycleId);
  return cycle?.applicants === "Students" && cycle.currentStatus === "Open" ? cycle : null;
}


// The picker id of a reused waitlisted application's challenge. It is pinned to
// whatever that application answered, which this cycle may not offer at all.
export const WAITLISTED_PICK = "waitlisted";

// The opaque picker id for a DA's picked challenge Form.
export function pickerId(da: {
  continuedFromId: string | null;
  challengeFormVersion: { formId: string } | null;
}): string | null {
  if (da.continuedFromId) return WAITLISTED_PICK;
  return da.challengeFormVersion ? `form:${da.challengeFormVersion.formId}` : null;
}

export async function loadPortalApply(request: Request, cycleId: string | undefined) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);

  const resolved = await resolveApplyCycle(cycleId);
  if ("choices" in resolved) {
    if (resolved.choices.length === 0) return redirect("/portal");
    return {
      kind: "choose" as const,
      choose: resolved.choices.map((c) => ({
        id: c.id,
        name: c.name,
        closeDate: c.closeDate ? c.closeDate.toISOString() : null,
        href: applicantPortalPath("Students", c.id),
      })),
    };
  }
  const active = resolved.cycle;

  // Load cycle with its hiring domains + per-domain challenge Forms. A domain
  // staged into an Open cycle (not yet ready) is invisible until its lead
  // marks it ready.
  const cycle = await prisma.applicationCycle.findUnique({
    where: { id: active.id },
    include: {
      domains: {
        where: { isReady: true },
        include: { domain: true },
      },
      domainChallengeForms: {
        include: {
          form: {
            include: { versions: { orderBy: { versionNumber: "desc" }, take: 1 } },
          },
        },
      },
    },
  });

  if (!cycle) return redirect("/portal");

  // General form: the cycle's bound Drive Form (applicationFormId).
  const form = cycle.applicationFormId
    ? await loadHiringForm(cycle.applicationFormId, auth.user.sub)
    : null;
  if (!form) return redirect("/portal");

  // The FormVersion the applicant's Application pins for the general form.
  const applicationFormVersionId = form.versionId;

  // Check for existing draft
  const draft = await prisma.application.findFirst({
    where: {
      userId: auth.user.sub,
      applicationCycleId: active.id,
    },
    include: {
      statusUpdates: { orderBy: { createdAt: "desc" }, take: 1 },
      applicationFormVersion: { select: { questions: true, intro: true } },
      domainApplications: {
        include: {
          challengeFormVersion: {
            select: { formId: true, questions: true, intro: true, form: { select: { name: true } } },
          },
          continuedFrom: {
            select: { application: { select: { applicationCycle: { select: { name: true } } } } },
          },
        },
      },
    },
  });

  // Domains reusing a waitlisted application. Their answers, and with them the
  // general answers, are frozen copies pinned to the forms they were written
  // against, so those are the questions shown, not this cycle's.
  const continuedDas = (draft?.domainApplications ?? []).filter(da => da.continuedFromId);
  const pinnedGeneral = continuedDas.length > 0 ? draft?.applicationFormVersion : null;
  const formQuestions = normalizeQuestionBodies(
    pinnedGeneral ? ((pinnedGeneral.questions as unknown) as Question[]) ?? [] : form.questions,
  );
  const generalDescription = ensureBlocks(
    pinnedGeneral ? safeParseJsonString(pinnedGeneral.intro) : form.description,
  );

  // Reuse is offered only when the cycle binds a continued interest form.
  const continuedInterestForm = cycle.continuedInterestFormId
    ? await loadHiringForm(cycle.continuedInterestFormId, auth.user.sub)
    : null;
  const waitlistedApplications = continuedInterestForm
    ? await listWaitlistedApplications(auth.user.sub, active.id)
    : [];

  // Per-domain application windows: a domain can close before or after the
  // cycle's own close date (DomainApplicationCycle.closeDate overrides it).
  // Read off the freshly-fetched `cycle` row above, not the 30s-cached
  // `active`, so a domain right at its deadline gets an accurate answer.
  const closedDomainIds = closedDomainIdSet(cycle.domains, cycle);
  const selectedDas = (draft?.domainApplications ?? [])
    .filter(da => da.selected)
    .map(da => ({ id: da.id, domainId: da.domainId }));
  const { generalFrozen } = frozenSelection(closedDomainIds, selectedDas);
  const closedSelectedDomainIds = selectedDas
    .filter(da => closedDomainIds.has(da.domainId))
    .map(da => da.domainId);
  const deadline = applicantDeadline(cycle.domains, cycle, selectedDas.map(da => da.domainId));

  // Build domain info with each domain's challenge Forms (applicant picks one).
  // Each option carries an opaque "form:<formId>" id. A cycle without
  // challenges offers bare domains. A domain reusing a waitlisted application
  // offers only that application's own challenge.
  const domains = cycle.domains.map(dac => {
    const closeDateIso = domainCloseDate(dac, cycle)?.toISOString() ?? null;
    const closed = closedDomainIds.has(dac.domainId);
    const continued = continuedDas.find(da => da.domainId === dac.domainId);
    if (continued) {
      const version = continued.challengeFormVersion;
      return {
        id: dac.domainId,
        name: dac.domain.name,
        closeDate: closeDateIso,
        closed,
        challenges: [
          {
            challengeVersionId: WAITLISTED_PICK,
            challengeName: version?.form.name ?? "",
            description: ensureBlocks(safeParseJsonString(version?.intro ?? null)),
            questions: normalizeQuestionBodies(((version?.questions as unknown) as Question[]) ?? []),
          },
        ],
      };
    }
    const formChallenges = (cycle.hasChallenges ? cycle.domainChallengeForms : [])
      .filter(cdf => cdf.domainId === dac.domainId && cdf.form.versions[0])
      .map(cdf => ({
        challengeVersionId: `form:${cdf.formId}`,
        challengeName: cdf.form.name,
        description: ensureBlocks(safeParseJsonString(cdf.form.versions[0]!.intro)),
        questions: normalizeQuestionBodies(
          ((cdf.form.versions[0]!.questions as unknown) as Question[]) ?? [],
        ),
      }));
    return {
      id: dac.domainId,
      name: dac.domain.name,
      closeDate: closeDateIso,
      closed,
      challenges: formChallenges,
    };
  });

  const draftStatus = draft?.statusUpdates[0]?.newStatus ?? null;

  const startTermOptions = offersStartTermChoice(cycle.startTermIds)
    ? await loadOfferedStartTerms(cycle.startTermIds)
    : [];

  return {
      kind: "apply" as const,
      cycleId: active.id,
      cycleName: active.name,
      hasChallenges: cycle.hasChallenges,
      closeDate: active.closeDate ? active.closeDate.toISOString() : null,
      applicationFormVersionId,
      formQuestions,
      generalDescription,
      domains,
      generalFrozen,
      closedSelectedDomainIds,
      deadline: deadline ? deadline.toISOString() : null,
      startTermOptions,
      waitlistedApplications,
      continuedInterest: continuedInterestForm
        ? {
            description: ensureBlocks(continuedInterestForm.description),
            questions: normalizeQuestionBodies(continuedInterestForm.questions),
          }
        : null,
      // domainId → the cycle its reused application was waitlisted in.
      continuedFrom: Object.fromEntries(
        continuedDas.map(da => [da.domainId, da.continuedFrom!.application.applicationCycle.name]),
      ),
      continuedInterestAnswers: Object.fromEntries(
        continuedDas.map(da => [da.domainId, (da.continuedInterestAnswers ?? {}) as Record<string, string>]),
      ),
      // ApplyForm seeds its state from the loader once, so it remounts when
      // reuse changes what the form is made of.
      formKey: continuedDas.map(da => `${da.domainId}:${da.continuedFromId}`).join(","),
      isAlreadySubmitted: draftStatus === "Submitted",
      draft: draft
        ? {
            id: draft.id,
            answers: draft.answers as Record<string, string>,
            startTermId: draft.startTermId,
            selectedDomainIds: draft.domainApplications
              .filter(da => da.selected)
              .map(da => da.domainId),
            domainApplications: draft.domainApplications.map(da => ({
              id: da.id,
              domainId: da.domainId,
              challengeVersionId: pickerId(da),
              answers: da.answers as Record<string, string>,
              submittedAt: da.submittedAt ? da.submittedAt.toISOString() : null,
            })),
          }
        : null,
    };
}

export type PortalApplyData = Exclude<Awaited<ReturnType<typeof loadPortalApply>>, Response>;
