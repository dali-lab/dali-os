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
      user: { select: { id: true, firstName: true, lastName: true } },
      domain: { select: { name: true } },
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

  // Display info per user — dedupe so a cross-listed member appears once
  // per slot. domainNames is a Set since one user can be on multiple domains.
  const userInfo = new Map<string, { firstName: string | null; lastName: string | null; domainNames: Set<string> }>();
  for (const r of interviewers) {
    const existing = userInfo.get(r.userId);
    if (existing) {
      existing.domainNames.add(r.domain.name);
    } else {
      userInfo.set(r.userId, {
        firstName: r.user.firstName,
        lastName: r.user.lastName,
        domainNames: new Set([r.domain.name]),
      });
    }
  }

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
    const freeInterviewers = Array.from(freeMembers)
      .map((uid) => {
        const info = userInfo.get(uid)!;
        return {
          id: uid,
          firstName: info.firstName,
          lastName: info.lastName,
          domains: Array.from(info.domainNames).sort(),
        };
      })
      .sort((a, b) => {
        const an = `${a.firstName ?? ""} ${a.lastName ?? ""}`.trim();
        const bn = `${b.firstName ?? ""} ${b.lastName ?? ""}`.trim();
        return an.localeCompare(bn);
      });
    return {
      startTime: slotStart.toISOString(),
      endTime: slotEnd.toISOString(),
      freeInterviewerCount: freeMembers.size,
      freeInterviewers,
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
