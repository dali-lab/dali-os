import type { Route } from "./+types/api.cycles.$cycleId.coverage";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { hasCycleAccess } from "~/lib/roles";
import { generateCandidateSlots, isInterviewerFree } from "~/hiring/lib/scheduling";

export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  if (!(await hasCycleAccess(auth.user.sub, params.cycleId!)))
    return Response.json({ error: "Forbidden" }, { status: 403 });

  const config = await prisma.interviewConfig.findUnique({
    where: { applicationCycleId: params.cycleId },
  });
  if (!config) {
    return Response.json({
      configured: false,
      slots: [],
      slotDurationMinutes: 30,
      timezone: "America/New_York",
    });
  }

  const interviewers = await prisma.cycleInterviewer.findMany({
    where: { applicationCycleId: params.cycleId },
    include: {
      availabilityBlocks: { select: { startTime: true, endTime: true } },
      interviewAssignments: {
        where: { status: "Active", interview: { status: "Scheduled" } },
        include: { interview: { select: { startTime: true, endTime: true } } },
      },
    },
  });

  // Per-member booked intervals (with buffer) — a member cross-listed on two
  // CycleInterviewer rows shares one booked set.
  const memberIntervals = new Map<string, { start: Date; end: Date }[]>();
  for (const r of interviewers) {
    const intervals = r.interviewAssignments.map((a) => ({
      start: new Date(a.interview.startTime.getTime() - config.bufferMinutes * 60_000),
      end: new Date(a.interview.endTime.getTime() + config.bufferMinutes * 60_000),
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
    config.interviewStartDate,
    config.interviewEndDate,
    config.dayStartHour,
    config.dayEndHour,
    config.slotDurationMinutes,
    config.timezone,
  );

  // Booked interviews in this cycle for the "● booked" overlay.
  const interviews = await prisma.interview.findMany({
    where: { applicationCycleId: params.cycleId, status: "Scheduled" },
    select: { startTime: true, endTime: true },
  });

  const slots = candidates.map((slotStart) => {
    const slotEnd = new Date(slotStart.getTime() + config.slotDurationMinutes * 60_000);
    const freeMembers = new Set<string>();
    for (const r of checks) {
      if (isInterviewerFree(r, slotStart, slotEnd)) freeMembers.add(r.userId);
    }
    const bookedCount = interviews.filter(
      (i) => i.startTime < slotEnd && i.endTime > slotStart,
    ).length;
    return {
      startTime: slotStart.toISOString(),
      endTime: slotEnd.toISOString(),
      freeInterviewerCount: freeMembers.size,
      bookedInterviewCount: bookedCount,
    };
  });

  return Response.json({
    configured: true,
    slots,
    slotDurationMinutes: config.slotDurationMinutes,
    timezone: config.timezone,
    totalInterviewers: interviewers.length,
  });
}
