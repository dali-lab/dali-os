import { redirect } from "react-router";
import { prisma } from "~/lib/db.server";
import { requireAuth } from "~/lib/auth";
import { logAuditEvent } from "~/lib/audit";
import { enqueueOutbound, drainNow } from "~/lib/outbound.server";
import { renderForSlot, notificationSlot } from "~/hiring/lib/email-variables";
import { type ActiveCycle } from "~/hiring/lib/cycles";
import { reuseWaitlistedApplication, stopUsingWaitlistedApplication } from "~/hiring/lib/continued-interest.server";
import { impliedStartTermId, isOfferedStartTerm, offersStartTermChoice } from "~/hiring/lib/start-terms.server";
import { reconcileDomainApplications } from "~/hiring/lib/domain-application";
import { applicationLock, closedDomainIdsForCycle, frozenSelection } from "~/hiring/lib/application-lock.server";
import { checkGitHubUrl, checkFigmaUrl, checkDriveUrl } from "~/lib/submission-check";
import type { SubmissionCheckResult } from "~/lib/submission-check";
import { validateWordLimits } from "~/lib/word-count";
import type { WordCountViolation } from "~/lib/word-count";
import { dropHiddenAnswers } from "~/forms/lib/form-logic";
import { isAnswered, normalizeAnswerFormats, validateAnswerFormats } from "~/forms/lib/form-answers";
import type { Question } from "~/types";
import { getHiringEmail } from "~/hiring/lib/hiring-emails.server";

import { openStudentsCycle, pickerId } from "./portal-apply.server";

type BaseContext = {
  userId: string;
  request: Request;
  formData: FormData;
  cycle: ActiveCycle;
  offeredStartTermIds: string[];
  startTermIsAsked: boolean;
  readStartTerm: (raw: FormDataEntryValue | null) => string | null | undefined;
};
export type NewApplicationContext = BaseContext & { applicationId: string | null };
export type OwnedApplicationContext = BaseContext & { applicationId: string };
type NewApplicationHandler = (ctx: NewApplicationContext) => Promise<unknown>;
type OwnedApplicationHandler = (ctx: OwnedApplicationContext) => Promise<unknown>;

// Continued interest questions per DA that reuses a waitlisted application.
// Presence in the map is what marks a DA's answers (and with any entry at all,
// the general answers) as frozen: nothing posted may overwrite them.
async function loadContinued(applicationId: string): Promise<Map<string, Question[]>> {
  const das = await prisma.domainApplication.findMany({
    where: { applicationId },
    select: {
      id: true,
      continuedFromId: true,
      continuedInterestFormVersion: { select: { questions: true } },
    },
  });
  return new Map(
    das
      .filter(da => da.continuedFromId)
      .map(da => [da.id, ((da.continuedInterestFormVersion?.questions ?? []) as unknown) as Question[]]),
  );
}

type PostedDomainAnswers = {
  domainApplicationId: string;
  answers: Record<string, string>;
  continuedInterestAnswers?: Record<string, string>;
};

async function saveAnswers(args: {
  applicationId: string;
  answers: unknown;
  // Caller has already dropped any entry for a frozen (closed-domain) DA.
  domainAnswers: PostedDomainAnswers[];
  startTermId: string | null | undefined;
  continued: Map<string, Question[]>;
  // A selected domain has closed: the shared general answers are under
  // review and stop accepting writes, same as a reused waitlisted answer.
  generalFrozen?: boolean;
}) {
  const { applicationId, answers, domainAnswers, startTermId, continued, generalFrozen = false } = args;
  await prisma.application.update({
    where: { id: applicationId },
    data: {
      ...(continued.size === 0 && !generalFrozen && { answers: answers as object }),
      ...(startTermId !== undefined && { startTermId }),
    },
  });
  for (const da of domainAnswers) {
    await prisma.domainApplication.updateMany({
      where: { id: da.domainApplicationId, applicationId },
      data: continued.has(da.domainApplicationId)
        ? { continuedInterestAnswers: da.continuedInterestAnswers ?? {} }
        : { answers: da.answers },
    });
  }
}

// Resolve + validate applicant challenge selections against the challenge Forms
// linked to the cycle. Each selection's `challengeVersionId` is an opaque
// "form:<formId>" id. Returns one pin per valid selection: {domainId,
// challengeFormVersionId} (the picked Form's latest version). A cycle without
// challenges pins every selected domain of the cycle with no challenge.
type ResolvedPin = { domainId: string; challengeFormVersionId: string | null };
async function resolveChallengeSelections(
  cycle: ActiveCycle,
  selections: { domainId: string; challengeVersionId: string }[],
): Promise<ResolvedPin[]> {
  const cycleDomains = await prisma.domainApplicationCycle.findMany({
    where: { applicationCycleId: cycle.id, isReady: true },
    select: { domainId: true },
  });
  const allowed = new Set(cycleDomains.map(d => d.domainId));
  if (!cycle.hasChallenges) {
    return [...new Set(selections.map(s => s.domainId))]
      .filter(id => allowed.has(id))
      .map(domainId => ({ domainId, challengeFormVersionId: null }));
  }
  const cycleId = cycle.id;
  const cdfs = await prisma.cycleDomainForm.findMany({
    where: { applicationCycleId: cycleId, domainId: { in: [...allowed] } },
    include: { form: { include: { versions: { orderBy: { versionNumber: "desc" }, take: 1 } } } },
  });
  const formVersionByPair = new Map(
    cdfs.map(c => [`${c.domainId}:${c.formId}`, c.form.versions[0]?.id]),
  );

  const out: ResolvedPin[] = [];
  for (const s of selections) {
    if (!s.challengeVersionId.startsWith("form:")) continue;
    const formId = s.challengeVersionId.slice("form:".length);
    const versionId = formVersionByPair.get(`${s.domainId}:${formId}`);
    if (versionId) out.push({ domainId: s.domainId, challengeFormVersionId: versionId });
  }
  return out;
}

const reuseWaitlisted: NewApplicationHandler = async ({ userId, formData, cycle, offeredStartTermIds }) => {
  const failed = await reuseWaitlistedApplication({
    userId: userId,
    cycle,
    waitlistedDomainApplicationId: formData.get("waitlistedDomainApplicationId") as string,
    startTermId: impliedStartTermId(offeredStartTermIds),
  });
  if (failed) return { error: "That application can't be used for this cycle." };
  return { reused: true };
};

const stopUsingWaitlisted: OwnedApplicationHandler = async ({ formData, cycle, applicationId }) => {
  await stopUsingWaitlistedApplication({
    applicationId,
    domainId: formData.get("domainId") as string,
    cycle,
  });
  return { reused: false };
};

const createDraft: NewApplicationHandler = async ({ userId, formData, cycle, offeredStartTermIds }) => {
  const cycleId = cycle.id;
  const applicationFormVersionId = (formData.get("applicationFormVersionId") as string) || null;
  const selectedDomains = JSON.parse(formData.get("selectedDomains") as string) as {
    domainId: string;
    challengeVersionId: string;
  }[];

  // A closed domain is never created on a fresh draft, even if the client
  // still posted it (e.g. a stale tab).
  const closedDomainIds = await closedDomainIdsForCycle(cycleId, cycle);
  const openSelections = selectedDomains.filter(s => !closedDomainIds.has(s.domainId));

  // Validate every chosen challenge Form is linked to this cycle for the
  // claimed domain, and resolve the pinned FormVersion.
  const resolved = await resolveChallengeSelections(cycle, openSelections);

  // Upsert keyed on the (userId, applicationCycleId) unique constraint so
  // that two concurrent "Start Application" clicks (e.g. from two open tabs)
  // converge on a single draft instead of creating duplicates. For an
  // existing row the update is a no-op — domain selection is reconciled
  // separately via the `update-domains` intent.
  const application = await prisma.application.upsert({
    where: {
      userId_applicationCycleId: {
        userId: userId,
        applicationCycleId: cycleId,
      },
    },
    update: {},
    create: {
      userId: userId,
      applicationCycleId: cycleId,
      applicationFormVersionId,
      answers: {},
      // A cycle offering exactly one start term records it rather than asking
      // (see offersStartTermChoice), so the board has the structured value
      // even when the applicant was never shown a choice.
      startTermId: impliedStartTermId(offeredStartTermIds),
      statusUpdates: {
        create: { newStatus: "Draft", userId: userId },
      },
      domainApplications: {
        create: resolved.map(r => ({
          domainId: r.domainId,
          ...(r.challengeFormVersionId && { challengeFormVersionId: r.challengeFormVersionId }),
          answers: {},
        })),
      },
    },
    include: {
      domainApplications: {
        include: {
          challengeFormVersion: { select: { formId: true } },
        },
      },
    },
  });

  return {
        draft: {
          id: application.id,
          answers: application.answers,
          selectedDomainIds: application.domainApplications.map(
            (da) => da.domainId,
          ),
          domainApplications: application.domainApplications.map((da) => ({
            id: da.id,
            domainId: da.domainId,
            challengeVersionId: pickerId(da),
            answers: da.answers,
          })),
        },
      };
};

const updateDomains: OwnedApplicationHandler = async ({ formData, cycle, applicationId }) => {
  const newSelections = JSON.parse(formData.get("selectedDomains") as string) as {
    domainId: string;
    challengeVersionId: string;
  }[];

  const existingDas = await prisma.domainApplication.findMany({
    where: { applicationId },
    select: { domainId: true, challengeFormVersionId: true, continuedFromId: true, selected: true },
  });

  // A domain reusing a waitlisted application keeps the challenge it is
  // pinned to, whatever was posted; that one isn't this cycle's to validate.
  const pinned = new Map(
    existingDas.filter(da => da.continuedFromId).map(da => [da.domainId, da.challengeFormVersionId]),
  );
  // A closed domain can't be added or removed by the applicant, even by
  // replaying the form: drop it from what was posted, then force-keep
  // whatever is already selected there with its existing (frozen) pick.
  const closedDomainIds = await closedDomainIdsForCycle(cycle.id, cycle);
  const closedSelected = new Map(
    existingDas
      .filter(da => da.domainId && da.selected && closedDomainIds.has(da.domainId))
      .map(da => [da.domainId!, da.challengeFormVersionId]),
  );
  const openPosted = newSelections.filter(s => !closedDomainIds.has(s.domainId));

  // Validate + resolve every other chosen challenge.
  const resolved = [
    ...(await resolveChallengeSelections(
      cycle,
      openPosted.filter(s => !pinned.has(s.domainId)),
    )),
    ...openPosted
      .filter(s => pinned.has(s.domainId))
      .map(s => ({ domainId: s.domainId, challengeFormVersionId: pinned.get(s.domainId) ?? null })),
    ...[...closedSelected.entries()].map(([domainId, challengeFormVersionId]) => ({
      domainId,
      challengeFormVersionId,
    })),
  ];
  const newDomainIds = resolved.map(r => r.domainId);
  const desiredFormByDomain = new Map(
    resolved.flatMap(r => (r.challengeFormVersionId ? [[r.domainId, r.challengeFormVersionId] as const] : [])),
  );

  await reconcileDomainApplications({
    applicationId,
    domainIds: newDomainIds,
    challengeFormVersionByDomain: desiredFormByDomain,
  });

  // Return full updated draft
  const updatedApp = await prisma.application.findUnique({
    where: { id: applicationId },
    include: {
      domainApplications: {
        include: {
          challengeFormVersion: { select: { formId: true } },
        },
      },
    },
  });

  return {
        draft: updatedApp ? {
          id: updatedApp.id,
          answers: updatedApp.answers,
          selectedDomainIds: newDomainIds,
          domainApplications: updatedApp.domainApplications.map((da) => ({
            id: da.id,
            domainId: da.domainId,
            challengeVersionId: pickerId(da),
            answers: da.answers,
          })),
        } : null,
      };
};

const saveDraft: OwnedApplicationHandler = async ({ formData, cycle, applicationId, readStartTerm }) => {
  const answers = JSON.parse(formData.get("answers") as string);
  const domainAnswers = JSON.parse(formData.get("domainAnswers") as string) as PostedDomainAnswers[];
  const selectedDas = await prisma.domainApplication.findMany({
    where: { applicationId, selected: true },
    select: { id: true, domainId: true },
  });
  const { frozenDaIds, generalFrozen } = await applicationLock(cycle.id, cycle, selectedDas);
  await saveAnswers({
    applicationId,
    answers,
    domainAnswers: domainAnswers.filter(da => !frozenDaIds.has(da.domainApplicationId)),
    startTermId: readStartTerm(formData.get("startTermId")),
    continued: await loadContinued(applicationId),
    generalFrozen,
  });

  return { saved: true };
};

const submit: OwnedApplicationHandler = async ({ userId, request, formData, cycle, applicationId, offeredStartTermIds, startTermIsAsked, readStartTerm }) => {
  const answers = JSON.parse(formData.get("answers") as string);
  const domainAnswersRaw = JSON.parse(formData.get("domainAnswers") as string) as PostedDomainAnswers[];
  const urlQuestions = JSON.parse(formData.get("urlQuestions") as string ?? "[]") as {
    key: string;
    url: string;
    type: "github_url" | "figma_url" | "drive_url";
  }[];
  const postedSelectedDomainIds = JSON.parse(formData.get("selectedDomainIds") as string) as string[];

  // Validate server-side before any writes. Trust the questions from the
  // ChallengeVersion record, not anything in the request payload.
  const application = await prisma.application.findUnique({
    where: { id: applicationId },
    select: {
      applicationCycleId: true,
      applicationFormVersion: { select: { questions: true } },
    },
  });
  if (!application) {
    return Response.json({ error: "Application not found" }, { status: 404 });
  }

  const allDas = await prisma.domainApplication.findMany({
    where: { applicationId },
    include: {
      challengeFormVersion: { select: { questions: true } },
    },
  });

  // A closed domain can neither be added nor removed here either, same
  // rule as update-domains: force-keep whatever is already selected there,
  // drop any closed domain the client tried to add.
  const closedDomainIds = await closedDomainIdsForCycle(cycle.id, cycle);
  const currentlySelected = allDas
    .filter(da => da.selected)
    .map(da => ({ id: da.id, domainId: da.domainId }));
  const { frozenDaIds, generalFrozen } = frozenSelection(closedDomainIds, currentlySelected);
  const existingSelectedClosedDomainIds = currentlySelected
    .filter(da => closedDomainIds.has(da.domainId))
    .map(da => da.domainId);
  const selectedDomainIds = [
    ...new Set([
      ...postedSelectedDomainIds.filter(id => !closedDomainIds.has(id)),
      ...existingSelectedClosedDomainIds,
    ]),
  ];
  const domainAnswers = domainAnswersRaw.filter(da => !frozenDaIds.has(da.domainApplicationId));

  // With only closed domains selected, a submit would mark the application
  // Submitted and send the confirmation while stamping no domain, so no
  // reviewer ever sees it.
  if (selectedDomainIds.length > 0 && selectedDomainIds.every(id => closedDomainIds.has(id))) {
    return { error: "Every domain you picked has closed. Add an open domain to submit." };
  }

  // Reused waitlisted answers were validated when they were first submitted
  // and can't be edited now; what gets checked for those DAs is the continued
  // interest form.
  const continued = await loadContinued(applicationId);
  const generalQuestions =
    continued.size > 0 || generalFrozen
      ? []
      : ((application.applicationFormVersion?.questions as unknown as Question[]) ?? []);
  const postedAnswers = (da: PostedDomainAnswers | undefined): Record<string, string> =>
    (da && continued.has(da.domainApplicationId) ? da.continuedInterestAnswers : da?.answers) ?? {};

  // Per-DA challenge questions: the picked challenge Form's version.
  const daQuestions = (dbDa: (typeof allDas)[number]): Question[] =>
    continued.get(dbDa.id) ??
    ((dbDa.challengeFormVersion?.questions ?? []) as unknown as Question[]);

  // Answers to questions a rule hid are dropped from the posted objects (the
  // same ones saved below) before any check, so a hidden question can't fail
  // one or reach storage. Each form is evaluated on its own answers.
  const visibleGeneral = dropHiddenAnswers(generalQuestions, answers);
  const visibleByDa = new Map<string, Question[]>();
  for (const dbDa of allDas) {
    const posted = domainAnswers.find(da => da.domainApplicationId === dbDa.id);
    visibleByDa.set(dbDa.id, dropHiddenAnswers(daQuestions(dbDa), postedAnswers(posted)));
  }

  const wordCountErrors: Record<string, WordCountViolation> = {
    ...validateWordLimits(visibleGeneral, answers),
  };
  for (const da of domainAnswers) {
    const dbDa = allDas.find(d => d.id === da.domainApplicationId);
    if (!dbDa) continue;
    Object.assign(wordCountErrors, validateWordLimits(visibleByDa.get(dbDa.id) ?? [], postedAnswers(da)));
  }
  if (Object.keys(wordCountErrors).length > 0) {
    return { wordCountErrors };
  }

  // Required-question validation. Client gates the review modal on this, but
  // we re-check server-side so the DB cannot end up with a submitted-but-empty
  // domain via a stale state, manual replay, or future refactor that loosens
  // the client gate. A frozen (closed-domain) answer can no longer be fixed,
  // so it's skipped — otherwise an incomplete closed challenge would block
  // submitting an open one forever.
  const missingRequired: string[] = [];
  if (!generalFrozen) {
    for (const q of visibleGeneral) {
      if (q.required && !isAnswered(answers[q.key], q)) {
        missingRequired.push(q.data.label || q.key);
      }
    }
  }
  for (const domainId of selectedDomainIds) {
    if (closedDomainIds.has(domainId)) continue;
    const dbDa = allDas.find(d => d.domainId === domainId);
    if (!dbDa) {
      missingRequired.push(`selected domain has no application record`);
      continue;
    }
    const questions = visibleByDa.get(dbDa.id) ?? [];
    const submitted = postedAnswers(domainAnswers.find(da => da.domainApplicationId === dbDa.id));
    for (const q of questions) {
      if (q.required && !isAnswered(submitted[q.key], q)) {
        missingRequired.push(q.data.label || q.key);
      }
    }
  }
  if (missingRequired.length > 0) {
    return {
      error: `Please answer all required questions before submitting (${missingRequired.length} unanswered).`,
    };
  }

  const answerSets: { questions: Question[]; answers: Record<string, string> }[] = [
    { questions: visibleGeneral, answers },
  ];
  for (const domainId of selectedDomainIds) {
    if (closedDomainIds.has(domainId)) continue;
    const dbDa = allDas.find(d => d.domainId === domainId);
    if (!dbDa) continue;
    answerSets.push({
      questions: visibleByDa.get(dbDa.id) ?? [],
      answers: postedAnswers(domainAnswers.find(da => da.domainApplicationId === dbDa.id)),
    });
  }
  for (const set of answerSets) {
    const formatErrors = validateAnswerFormats(set.questions, set.answers);
    if (formatErrors.length > 0) return { error: formatErrors[0].message };
    normalizeAnswerFormats(set.questions, set.answers);
  }

  // The start term is required whenever the cycle offers a choice. Re-checked
  // here rather than trusting the client gate, for the same reason the
  // required questions above are: a stale state or a replayed request must not
  // land a submitted application with no start term. Falls back to what is
  // already stored so a resubmit without the field keeps the earlier pick.
  let startTermId: string | null | undefined;
  if (startTermIsAsked) {
    startTermId = readStartTerm(formData.get("startTermId"));
    const effective =
      startTermId !== undefined
        ? startTermId
        : (
            await prisma.application.findUnique({
              where: { id: applicationId },
              select: { startTermId: true },
            })
          )?.startTermId ?? null;
    if (!isOfferedStartTerm(offeredStartTermIds, effective)) {
      return { error: "Choose the term you'd start in before submitting." };
    }
    startTermId = effective;
  }

  // Save final answers
  await saveAnswers({ applicationId, answers, domainAnswers, startTermId, continued, generalFrozen });

  // Persist final domain selection state
  const toSelect = allDas.filter(da => selectedDomainIds.includes(da.domainId) && !da.selected);
  const toDeselect = allDas.filter(da => !selectedDomainIds.includes(da.domainId) && da.selected);
  if (toSelect.length > 0) {
    await prisma.domainApplication.updateMany({
      where: { id: { in: toSelect.map(da => da.id) } },
      data: { selected: true },
    });
  }
  if (toDeselect.length > 0) {
    await prisma.domainApplication.updateMany({
      where: { id: { in: toDeselect.map(da => da.id) } },
      data: { selected: false },
    });
  }

  // Stamp the submission time on every selected DA whose domain is open.
  // A closed (frozen) one is left untouched, submitted or not.
  const openSelectedDaIds = allDas
    .filter(da => selectedDomainIds.includes(da.domainId) && !closedDomainIds.has(da.domainId))
    .map(da => da.id);
  if (openSelectedDaIds.length > 0) {
    await prisma.domainApplication.updateMany({
      where: { id: { in: openSelectedDaIds } },
      data: { submittedAt: new Date() },
    });
  }

  // Run server-side URL checks (non-blocking — warnings only)
  const urlWarnings: Record<string, SubmissionCheckResult> = {};
  const urlCheckResults = await Promise.all(
    urlQuestions
      .filter(q => q.url.trim())
      .map(async q => ({
        key: q.key,
        result: await (
          q.type === "figma_url"
            ? checkFigmaUrl(q.url)
            : q.type === "drive_url"
              ? checkDriveUrl(q.url)
              : checkGitHubUrl(q.url)
        ),
      })),
  );
  for (const { key, result } of urlCheckResults) {
    if (result.status !== "valid") {
      urlWarnings[key] = result;
    }
  }

  if (Object.keys(urlWarnings).length > 0) {
    return { urlWarnings };
  }

  // Create Submitted status update only on first submission
  const existingSubmitted = await prisma.applicationStatusUpdate.findFirst({
    where: { applicationId, newStatus: "Submitted" },
  });
  if (!existingSubmitted) {
    await prisma.applicationStatusUpdate.create({
      data: {
        newStatus: "Submitted",
        applicationId,
        userId: userId,
      },
    });
    await logAuditEvent({
      action: "application.submit",
      userId: userId,
      targetId: applicationId,
      metadata: { cycleId: application.applicationCycleId, domainIds: selectedDomainIds },
      request,
    });

    // Best-effort confirmation email — enqueued to the outbox (keyed per
    // application so a resubmit/retry can't double-send).
    try {
      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (user) {
        const to = user.dartmouthEmail ?? user.daliEmail ?? "";
        if (to) {
          const binding = await getHiringEmail(notificationSlot("ApplicationReceived"));
          if (binding) {
            // ApplicationReceived isn't tied to a single domain (an applicant
            // may apply to multiple), so {{domain}} is intentionally not passed
            // here — the registry reflects this and the editor warns leads who
            // try to use {{domain}} in this slot.
            const { subject, html } = renderForSlot(
              notificationSlot("ApplicationReceived"),
              binding,
              { firstName: user.firstName },
            );
            const { id } = await enqueueOutbound({
              channel: "email",
              purpose: "Hiring",
              dedupKey: `hiring.apply.confirmation:${application.applicationCycleId}:${userId}`,
              target: to,
              subject,
              bodyHtml: html,
              recipientUserId: userId,
              eventType: "hiring.apply.confirmation",
            });
            await drainNow([id]);
          }
        }
      }
    } catch (err) {
      console.error("Failed to send application confirmation email:", err);
    }
  }

  // Signal first-time submission so the tracker can play a one-shot confetti.
  // Subsequent edit-saves keep the plain redirect so the animation does not replay.
  const tracker = `/portal/hiring?cycle=${cycle.id}`;
  return redirect(existingSubmitted ? tracker : `${tracker}&just-submitted=1`);
};

export const NEW_APPLICATION_ACTIONS = {
  "create-draft": createDraft,
  "use-waitlisted": reuseWaitlisted,
} satisfies Record<string, NewApplicationHandler>;

export type NewApplicationIntent = keyof typeof NEW_APPLICATION_ACTIONS;

export const OWNED_APPLICATION_ACTIONS = {
  "stop-using-waitlisted": stopUsingWaitlisted,
  "update-domains": updateDomains,
  "save-draft": saveDraft,
  "submit": submit,
} satisfies Record<string, OwnedApplicationHandler>;

export type OwnedApplicationIntent = keyof typeof OWNED_APPLICATION_ACTIONS;

function isOwnedApplicationIntent(intent: string): intent is OwnedApplicationIntent {
  return Object.hasOwn(OWNED_APPLICATION_ACTIONS, intent);
}

export const PORTAL_APPLY_ACTIONS = { ...NEW_APPLICATION_ACTIONS, ...OWNED_APPLICATION_ACTIONS };

export async function resolveApplyTarget(
  intent: string,
  formData: FormData,
  userId: string,
): Promise<{ cycle: ActiveCycle; applicationId: string | null } | null> {
  if (isNewApplicationIntent(intent)) {
    const cycle = await openStudentsCycle(formData.get("cycleId") as string);
    return cycle ? { cycle, applicationId: null } : null;
  }
  const owned = await prisma.application.findFirst({
    where: { id: formData.get("applicationId") as string, userId },
    select: { id: true, applicationCycleId: true },
  });
  const cycle = owned ? await openStudentsCycle(owned.applicationCycleId) : null;
  return cycle && owned ? { cycle, applicationId: owned.id } : null;
}

function isNewApplicationIntent(intent: string): intent is NewApplicationIntent {
  return Object.hasOwn(NEW_APPLICATION_ACTIONS, intent);
}

export async function runPortalApplyAction(request: Request) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  const userId = auth.user.sub;

  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  const target = await resolveApplyTarget(intent, formData, userId);
  if (!target) {
    return Response.json({ error: "This cycle isn't open for applications." }, { status: 409 });
  }
  const { cycle, applicationId } = target;

  const offeredStartTermIds = cycle.startTermIds ?? [];
  const startTermIsAsked = offersStartTermChoice(offeredStartTermIds);
  const readStartTerm = (raw: FormDataEntryValue | null): string | null | undefined => {
    if (!startTermIsAsked || typeof raw !== "string") return undefined;
    if (raw === "") return null;
    return isOfferedStartTerm(offeredStartTermIds, raw) ? raw : undefined;
  };
  const base = { userId, request, formData, cycle, offeredStartTermIds, startTermIsAsked, readStartTerm };

  if (isNewApplicationIntent(intent)) {
    return NEW_APPLICATION_ACTIONS[intent]({ ...base, applicationId });
  }
  if (isOwnedApplicationIntent(intent) && applicationId) {
    return OWNED_APPLICATION_ACTIONS[intent]({ ...base, applicationId });
  }
  return { error: "Unknown intent" };
}
