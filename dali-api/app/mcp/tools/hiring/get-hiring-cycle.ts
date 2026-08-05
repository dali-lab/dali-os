// MCP `get_hiring_cycle` — returns one cycle's status, interview config, and
// a slot coverage summary. Folds what the web exposes across
// api.cycles.$cycleId.status, .interview-config, and .coverage.
//
// Access gate: hasCycleAccess (Core, any DomainLead, or a CycleReviewer/
// CycleInterviewer for this specific cycle). No confidentiality gate — status
// and scheduling configuration are not applicant PII.

import { prisma } from "~/lib/db";
import { hasCycleAccess } from "~/lib/roles";
import { generateCandidateSlots, isInterviewerFree } from "~/hiring/lib/scheduling";
import { APPLICATION_TZ } from "~/lib/timezone";
import { McpNotFoundError, McpForbiddenError } from "../../registry";

export const GET_HIRING_CYCLE_TOOL = {
  name: "get_hiring_cycle",
  description:
    "Get a hiring cycle's current status, interview configuration, and slot coverage summary. Requires cycle access (Core, domain lead, or reviewer/interviewer on the cycle).",
  inputSchema: {
    type: "object" as const,
    properties: {
      cycleId: {
        type: "string",
        minLength: 1,
        description: "ApplicationCycle.id, as returned by `list_hiring_cycles`.",
      },
    },
    required: ["cycleId"],
    additionalProperties: false,
  },
  requiredScope: "mcp:read" as const,
};

type Input = { cycleId: string };

export async function runGetHiringCycle(userId: string, input: Input): Promise<unknown> {
  if (!(await hasCycleAccess(userId, input.cycleId))) {
    throw new McpForbiddenError("No access to this cycle");
  }

  const cycle = await prisma.applicationCycle.findUnique({
    where: { id: input.cycleId },
    select: {
      id: true,
      name: true,
      cycleType: true,
      closeDate: true,
      createdAt: true,
      statusUpdates: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { newStatus: true },
      },
      domains: {
        select: {
          domainId: true,
          isReady: true,
          domain: { select: { name: true, displayName: true } },
        },
      },
    },
  });
  if (!cycle) throw new McpNotFoundError("Cycle not found");

  const currentStatus = cycle.statusUpdates[0]?.newStatus ?? "Draft";

  const interviewConfig = await prisma.interviewConfig.findUnique({
    where: { applicationCycleId: input.cycleId },
  });

  // Coverage: only compute when interview config exists.
  let coverage: unknown = null;
  if (interviewConfig) {
    const interviewers = await prisma.cycleInterviewer.findMany({
      where: { applicationCycleId: input.cycleId },
      include: {
        availabilityBlocks: { select: { startTime: true, endTime: true } },
        interviewAssignments: {
          where: { status: "Active", interview: { status: "Scheduled" } },
          include: { interview: { select: { startTime: true, endTime: true } } },
        },
      },
    });

    const memberIntervals = new Map<string, { start: Date; end: Date }[]>();
    for (const r of interviewers) {
      const intervals = r.interviewAssignments.map((a) => ({
        start: new Date(a.interview.startTime.getTime() - interviewConfig.bufferMinutes * 60_000),
        end: new Date(a.interview.endTime.getTime() + interviewConfig.bufferMinutes * 60_000),
      }));
      memberIntervals.set(r.userId, (memberIntervals.get(r.userId) ?? []).concat(intervals));
    }

    const checks = interviewers.map((r) => ({
      cycleInterviewerId: r.id,
      userId: r.userId,
      domainId: r.domainId,
      availability: r.availabilityBlocks,
      bookedIntervals: memberIntervals.get(r.userId) ?? [],
    }));

    const candidates = generateCandidateSlots(
      interviewConfig.interviewStartDate,
      interviewConfig.interviewEndDate,
      interviewConfig.dayStartHour,
      interviewConfig.dayEndHour,
      interviewConfig.slotDurationMinutes,
      interviewConfig.timezone,
    );

    const scheduledInterviews = await prisma.interview.findMany({
      where: { applicationCycleId: input.cycleId, status: "Scheduled" },
      select: { startTime: true, endTime: true },
    });

    let totalSlots = 0;
    let coveredSlots = 0;
    for (const slotStart of candidates) {
      totalSlots++;
      const slotEnd = new Date(slotStart.getTime() + interviewConfig.slotDurationMinutes * 60_000);
      const hasFree = checks.some((r) => isInterviewerFree(r, slotStart, slotEnd));
      if (hasFree) coveredSlots++;
    }
    const bookedCount = scheduledInterviews.length;

    coverage = {
      configured: true,
      totalSlots,
      coveredSlots,
      bookedInterviewCount: bookedCount,
      totalInterviewers: interviewers.length,
      timezone: interviewConfig.timezone,
      slotDurationMinutes: interviewConfig.slotDurationMinutes,
    };
  } else {
    coverage = { configured: false };
  }

  return {
    id: cycle.id,
    name: cycle.name,
    cycleType: cycle.cycleType,
    status: currentStatus,
    closeDate: cycle.closeDate?.toISOString() ?? null,
    createdAt: cycle.createdAt.toISOString(),
    domains: cycle.domains.map((d) => ({
      domainId: d.domainId,
      name: d.domain.displayName ?? d.domain.name,
      isReady: d.isReady,
    })),
    interviewConfig: interviewConfig
      ? {
          slotDurationMinutes: interviewConfig.slotDurationMinutes,
          bufferMinutes: interviewConfig.bufferMinutes,
          dayStartHour: interviewConfig.dayStartHour,
          dayEndHour: interviewConfig.dayEndHour,
          interviewStartDate: interviewConfig.interviewStartDate.toISOString(),
          interviewEndDate: interviewConfig.interviewEndDate.toISOString(),
          timezone: interviewConfig.timezone ?? APPLICATION_TZ,
          rescheduleNoticeHours: interviewConfig.rescheduleNoticeHours,
          cancelNoticeHours: interviewConfig.cancelNoticeHours,
          bookingNoticeHours: interviewConfig.bookingNoticeHours,
        }
      : null,
    coverage,
  };
}
