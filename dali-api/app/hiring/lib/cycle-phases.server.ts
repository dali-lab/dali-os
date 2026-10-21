import { prisma } from "~/lib/db";
import { inReviewPipelineFilter } from "./application-pipeline-filter";
import { FIRST_INTERVIEW_ROUND_ID as FIRST, delibRounds, interviewRounds, parseTimeline, type Timeline } from "./cycle-timeline";
import { interviewTaskKey } from "./cycle-phases";

// Whether each timeline task is done, read from the cycle's real data rather
// than ticked by hand, so the checklist can't drift from what actually happened.
// Keys match tasksForBlock: fixed task keys, `round:<id>` per delib round, and
// interviewTaskKey(...) per Interviews round.

const OUTCOMES = ["Accepted", "Waitlisted", "Rejected"] as const;

export type CycleProgress = {
  term: { id: string; code: string; startDate: Date } | null;
  timeline: Timeline;
  done: Record<string, boolean>;
};

export async function getCycleProgress(cycleId: string): Promise<CycleProgress> {
  const cycle = await prisma.applicationCycle.findUniqueOrThrow({
    where: { id: cycleId },
    select: {
      openDate: true,
      closeDate: true,
      applicationFormId: true,
      generalRubricVersionId: true,
      hasChallenges: true,
      timeline: true,
      term: { select: { id: true, code: true, startDate: true } },
      statusUpdates: { orderBy: { createdAt: "desc" }, take: 1, select: { newStatus: true } },
      domains: { select: { domainId: true, isReady: true, rubricVersionId: true } },
      domainChallengeForms: { select: { domainId: true } },
      interviewConfigs: { select: { interviewRoundId: true } },
    },
  });
  const timeline = parseTimeline(cycle.timeline);
  const domainIds = cycle.domains.map((d) => d.domainId);
  const inCycle = { application: { applicationCycleId: cycleId, ...inReviewPipelineFilter } };

  const [
    reviewers,
    interviewers,
    reviewsTotal,
    reviewsOpen,
    closedSessions,
    invitedDas,
    releasedInviteDas,
    scheduledInterviews,
    completedInterviews,
    outcomeDas,
    releasedOutcomeDas,
  ] = await Promise.all([
    prisma.cycleReviewer.findMany({ where: { applicationCycleId: cycleId }, select: { domainId: true } }),
    prisma.cycleInterviewer.findMany({
      where: { applicationCycleId: cycleId },
      select: { domainId: true, interviewRoundId: true },
    }),
    prisma.applicationReview.count({ where: { domainApplication: inCycle } }),
    prisma.applicationReview.count({ where: { domainApplication: inCycle, submittedAt: null } }),
    prisma.delibsSession.findMany({
      where: { applicationCycleId: cycleId, status: "Closed" },
      select: { domainId: true, roundId: true },
    }),
    prisma.decision.findMany({
      where: { type: "InvitedToInterview", domainApplication: inCycle },
      select: { domainApplicationId: true, interviewRoundId: true },
      distinct: ["domainApplicationId", "interviewRoundId"],
    }),
    prisma.decision.findMany({
      where: { type: "InvitedToInterview", stage: "Released", domainApplication: inCycle },
      select: { domainApplicationId: true, interviewRoundId: true },
      distinct: ["domainApplicationId", "interviewRoundId"],
    }),
    prisma.interview.findMany({
      where: { applicationCycleId: cycleId, status: "Scheduled" },
      select: { interviewRoundId: true },
    }),
    prisma.interview.findMany({
      where: { applicationCycleId: cycleId, status: "Completed" },
      select: { interviewRoundId: true },
    }),
    prisma.domainApplication.count({
      where: { ...inCycle, decisions: { some: { type: { in: [...OUTCOMES] } } } },
    }),
    prisma.domainApplication.count({
      where: { ...inCycle, decisions: { some: { type: { in: [...OUTCOMES] }, stage: "Released" } } },
    }),
  ]);

  const everyDomain = (covered: { domainId: string }[]) => {
    const have = new Set(covered.map((c) => c.domainId));
    return domainIds.length > 0 && domainIds.every((id) => have.has(id));
  };
  const status = cycle.statusUpdates[0]?.newStatus ?? "Draft";

  const done: Record<string, boolean> = {
    domains: cycle.domains.length > 0 && cycle.domains.every((d) => d.isReady),
    applicationDates: cycle.openDate != null && cycle.closeDate != null,
    challenges: everyDomain(cycle.domainChallengeForms),
    applicationForm: cycle.applicationFormId != null,
    rubrics:
      cycle.generalRubricVersionId != null &&
      (!cycle.hasChallenges || cycle.domains.every((d) => d.rubricVersionId != null)),
    openApplications: status !== "Draft",
    reviewers: everyDomain(reviewers),
    reviews: reviewsTotal > 0 && reviewsOpen === 0,
    sendDecisions: outcomeDas > 0 && releasedOutcomeDas === outcomeDas,
  };
  for (const { id } of interviewRounds(timeline)) {
    const inRound = (r: { interviewRoundId: string | null }) => (r.interviewRoundId ?? FIRST) === id;
    const invited = invitedDas.filter(inRound).length;
    done[interviewTaskKey("interviewers", id)] = everyDomain(interviewers.filter(inRound));
    done[interviewTaskKey("interviewSchedule", id)] = cycle.interviewConfigs.some(inRound);
    done[interviewTaskKey("interviewInvites", id)] = invited > 0 && releasedInviteDas.filter(inRound).length === invited;
    done[interviewTaskKey("conductInterviews", id)] =
      completedInterviews.some(inRound) && !scheduledInterviews.some(inRound);
  }
  // A round is held once every domain's board for it has closed.
  for (const round of delibRounds(timeline)) {
    done[`round:${round.id}`] = everyDomain(closedSessions.filter((s) => s.roundId === round.id));
  }

  return { term: cycle.term, timeline, done };
}
