import type { Prisma } from "~/generated/prisma/client";
import { prisma } from "~/lib/db";

// ─── Types ───────────────────────────────────────────────────────────────────

interface AvailableSlot {
  startTime: string; // ISO UTC
  endTime: string;   // ISO UTC
}

interface InterviewerFreeCheck {
  cycleInterviewerId: string;
  daliMemberId: string;
  domainId: string;
  availability: { startTime: Date; endTime: Date }[];
  bookedIntervals: { start: Date; end: Date }[]; // aggregated across ALL rows for this member; includes buffer
}

// The filter applied to every `interviewAssignments` include in this file.
// Restricts to (a) still-active assignments and (b) assignments whose parent
// interview is still active. Cancelled or Completed parents no longer
// contribute to any interviewer's booked intervals.
const ACTIVE_ASSIGNMENT_WITH_ACTIVE_INTERVIEW = {
  status: "Active" as const,
  interview: { status: "Scheduled" as const },
} satisfies Prisma.InterviewAssignmentWhereInput;

// Build per-member aggregations from a scoped findMany result. Both maps are
// cycle-scoped automatically because the input rows were already filtered by
// applicationCycleId, and interviewAssignments were filtered to Active.
function buildMemberAggregations(
  interviewers: Array<{
    daliMemberId: string;
    interviewAssignments: Array<{ interview: { startTime: Date; endTime: Date } }>;
  }>,
  bufferMinutes: number,
): { memberIntervals: Map<string, { start: Date; end: Date }[]>; memberActiveCount: Map<string, number> } {
  const memberIntervals = new Map<string, { start: Date; end: Date }[]>();
  const memberActiveCount = new Map<string, number>();
  for (const r of interviewers) {
    const intervals = r.interviewAssignments.map((a) => ({
      start: new Date(a.interview.startTime.getTime() - bufferMinutes * 60_000),
      end: new Date(a.interview.endTime.getTime() + bufferMinutes * 60_000),
    }));
    memberIntervals.set(
      r.daliMemberId,
      (memberIntervals.get(r.daliMemberId) ?? []).concat(intervals),
    );
    memberActiveCount.set(
      r.daliMemberId,
      (memberActiveCount.get(r.daliMemberId) ?? 0) + r.interviewAssignments.length,
    );
  }
  return { memberIntervals, memberActiveCount };
}

// ─── computeAvailableSlots ───────────────────────────────────────────────────
//
// Returns time windows where at least 1 in-domain interviewer AND 1 cross-domain
// interviewer are both free. Does NOT expose interviewer identities.

export async function computeAvailableSlots(
  cycleId: string,
  applicantDomainIds: string[],
): Promise<AvailableSlot[]> {
  const config = await prisma.interviewConfig.findUnique({
    where: { applicationCycleId: cycleId },
  });
  if (!config) return [];

  const { slotDurationMinutes, bufferMinutes, dayStartHour, dayEndHour, interviewStartDate, interviewEndDate, timezone } = config;

  // Load all cycle interviewers with their availability and booked interviews.
  // The interviewAssignments include filters out assignments whose parent
  // interview has been cancelled or completed — those no longer block slots.
  const interviewers = await prisma.cycleInterviewer.findMany({
    where: { applicationCycleId: cycleId },
    include: {
      availabilityBlocks: true,
      interviewAssignments: {
        where: ACTIVE_ASSIGNMENT_WITH_ACTIVE_INTERVIEW,
        include: { interview: true },
      },
    },
  });

  // Aggregate booked intervals per MEMBER (not per row). A member with
  // multiple CycleInterviewer rows in this cycle shares one set of
  // bookedIntervals, so a conflict on one row blocks the other row too.
  const { memberIntervals } = buildMemberAggregations(interviewers, bufferMinutes);

  // Build free-check data per interviewer
  const interviewerChecks: InterviewerFreeCheck[] = interviewers.map((r) => ({
    cycleInterviewerId: r.id,
    daliMemberId: r.daliMemberId,
    domainId: r.domainId,
    availability: r.availabilityBlocks.map((b) => ({
      startTime: b.startTime,
      endTime: b.endTime,
    })),
    bookedIntervals: memberIntervals.get(r.daliMemberId) ?? [],
  }));

  // Generate candidate slot start times
  const candidates = generateCandidateSlots(
    interviewStartDate,
    interviewEndDate,
    dayStartHour,
    dayEndHour,
    slotDurationMinutes,
    timezone,
  );

  const results: AvailableSlot[] = [];

  for (const slotStart of candidates) {
    const slotEnd = new Date(slotStart.getTime() + slotDurationMinutes * 60_000);

    const inDomainFree = interviewerChecks.some(
      (r) => applicantDomainIds.includes(r.domainId) && isInterviewerFree(r, slotStart, slotEnd),
    );
    const crossDomainFree = interviewerChecks.some(
      (r) => !applicantDomainIds.includes(r.domainId) && isInterviewerFree(r, slotStart, slotEnd),
    );

    if (inDomainFree && crossDomainFree) {
      results.push({
        startTime: slotStart.toISOString(),
        endTime: slotEnd.toISOString(),
      });
    }
  }

  return results;
}

// ─── assignInterviewers ──────────────────────────────────────────────────────
//
// Called when an applicant books a slot. Picks the least-scheduled free
// interviewer for each role (in-domain, cross-domain) and atomically creates
// the Interview + two InterviewAssignment rows.
//
// Accepts an optional `tx` parameter so callers that are already inside a
// transaction (e.g. reschedule, which cancels the old interview and creates a
// new one atomically) can compose without nesting. When called without `tx`,
// opens its own serializable transaction.

export async function assignInterviewers(
  cycleId: string,
  domainApplicationId: string,
  applicantDomainIds: string[],
  slotStart: Date,
  slotEnd: Date,
  tx?: Prisma.TransactionClient,
) {
  if (tx) {
    return assignInterviewersWithTx(tx, cycleId, domainApplicationId, applicantDomainIds, slotStart, slotEnd);
  }
  return prisma.$transaction(
    (innerTx) =>
      assignInterviewersWithTx(innerTx, cycleId, domainApplicationId, applicantDomainIds, slotStart, slotEnd),
    { isolationLevel: "Serializable" },
  );
}

async function assignInterviewersWithTx(
  tx: Prisma.TransactionClient,
  cycleId: string,
  domainApplicationId: string,
  applicantDomainIds: string[],
  slotStart: Date,
  slotEnd: Date,
) {
  const config = await tx.interviewConfig.findUnique({
    where: { applicationCycleId: cycleId },
  });
  if (!config) throw new Error("No interview config for this cycle");

  const { bufferMinutes } = config;

  // Lock candidate interviewers to prevent double-booking race
  const cycleInterviewers = await tx.cycleInterviewer.findMany({
    where: { applicationCycleId: cycleId },
    select: { id: true },
  });
  if (cycleInterviewers.length > 0) {
    const ids = cycleInterviewers.map((i) => i.id);
    await tx.$executeRaw`SELECT id FROM "CycleInterviewer" WHERE id = ANY(${ids}::text[]) FOR UPDATE`;
  }

  const interviewers = await tx.cycleInterviewer.findMany({
    where: { applicationCycleId: cycleId },
    include: {
      availabilityBlocks: true,
      interviewAssignments: {
        where: ACTIVE_ASSIGNMENT_WITH_ACTIVE_INTERVIEW,
        include: { interview: true },
      },
    },
  });

  // Aggregate booked intervals + load counts per MEMBER. A member with
  // multiple CycleInterviewer rows in this cycle shares one bookedIntervals
  // set (so cross-row conflicts are detected) and one activeCount (so
  // leastLoaded picks the actually-least-loaded human, not the
  // less-booked-in-this-particular-domain row).
  const { memberIntervals, memberActiveCount } = buildMemberAggregations(
    interviewers,
    bufferMinutes,
  );

  const checks: (InterviewerFreeCheck & { activeCount: number })[] = interviewers.map((r) => ({
    cycleInterviewerId: r.id,
    daliMemberId: r.daliMemberId,
    domainId: r.domainId,
    availability: r.availabilityBlocks.map((b) => ({
      startTime: b.startTime,
      endTime: b.endTime,
    })),
    bookedIntervals: memberIntervals.get(r.daliMemberId) ?? [],
    activeCount: memberActiveCount.get(r.daliMemberId) ?? 0,
  }));

  // Find least-scheduled free in-domain interviewer
  const inDomainCandidates = checks
    .filter((r) => applicantDomainIds.includes(r.domainId) && isInterviewerFree(r, slotStart, slotEnd))
    .sort((a, b) => a.activeCount - b.activeCount);

  if (inDomainCandidates.length === 0) {
    throw new Error("No in-domain interviewer available for this slot");
  }

  const inDomainPick = inDomainCandidates[0];

  // Find least-scheduled free cross-domain interviewer. Exclude the chosen
  // in-domain interviewer's MEMBER (not just their row): if Mira is the
  // in-domain pick under her Eng row, her Design row must not be the
  // cross-domain pick for the same interview.
  const crossDomainCandidates = checks
    .filter(
      (r) =>
        !applicantDomainIds.includes(r.domainId) &&
        r.daliMemberId !== inDomainPick.daliMemberId &&
        isInterviewerFree(r, slotStart, slotEnd),
    )
    .sort((a, b) => a.activeCount - b.activeCount);

  if (crossDomainCandidates.length === 0) {
    throw new Error("No cross-domain interviewer available for this slot");
  }

  const interview = await tx.interview.create({
    data: {
      domainApplicationId,
      applicationCycleId: cycleId,
      startTime: slotStart,
      endTime: slotEnd,
      status: "Scheduled",
      assignments: {
        create: [
          {
            cycleInterviewerId: inDomainPick.cycleInterviewerId,
            role: "InDomain",
            status: "Active",
          },
          {
            cycleInterviewerId: crossDomainCandidates[0].cycleInterviewerId,
            role: "CrossDomain",
            status: "Active",
          },
        ],
      },
    },
    include: { assignments: true },
  });

  return interview;
}

// ─── reassignInterviewer ─────────────────────────────────────────────────────
//
// Atomic interviewer swap. Either finds a replacement and commits the swap
// (declining assignment → Declined, new assignment → Active) or throws
// "No replacement interviewer available" — in which case the enclosing
// serializable transaction rolls back everything, leaving the declining
// assignment as Active. Never produces an interview with fewer than two
// active assignments. Callers (the decline endpoint) catch the throw and
// return a 409 so the interviewer sees an error.

const REPLACEMENT_UNAVAILABLE = "No replacement interviewer available";

export async function reassignInterviewer(
  interviewId: string,
  decliningAssignmentId: string,
) {
  return prisma.$transaction(async (tx) => {
    const assignment = await tx.interviewAssignment.findUnique({
      where: { id: decliningAssignmentId },
      include: {
        interview: {
          include: {
            domainApplication: { include: { challengeVersion: true } },
          },
        },
        cycleInterviewer: true,
      },
    });
    if (!assignment) throw new Error("Assignment not found");
    if (assignment.interview.id !== interviewId) {
      throw new Error("Assignment does not belong to this interview");
    }

    const { interview } = assignment;
    const config = await tx.interviewConfig.findUnique({
      where: { applicationCycleId: interview.applicationCycleId },
    });
    if (!config) throw new Error("No interview config");

    const { bufferMinutes } = config;
    const role = assignment.role;

    // Applicant's domain — used for the in-domain / cross-domain filter.
    const applicantDomainId = interview.domainApplication.challengeVersion.domainId;

    // Exclude any MEMBER (not just their row) who already holds an active
    // assignment on this interview. Without this, a member with multiple
    // CycleInterviewer rows could be "reassigned" onto themselves via a
    // different row.
    const existingAssignments = await tx.interviewAssignment.findMany({
      where: { interviewId: interview.id, status: "Active" },
      include: { cycleInterviewer: { select: { daliMemberId: true } } },
    });
    const existingMemberIds = new Set(
      existingAssignments.map((a) => a.cycleInterviewer.daliMemberId),
    );

    // Load every CycleInterviewer in the cycle so we can build member-level
    // aggregations (same pattern as assignInterviewers).
    const allInterviewers = await tx.cycleInterviewer.findMany({
      where: { applicationCycleId: interview.applicationCycleId },
      include: {
        availabilityBlocks: true,
        interviewAssignments: {
          where: ACTIVE_ASSIGNMENT_WITH_ACTIVE_INTERVIEW,
          include: { interview: true },
        },
      },
    });
    const { memberIntervals, memberActiveCount } = buildMemberAggregations(
      allInterviewers,
      bufferMinutes,
    );

    const candidates = allInterviewers.filter((r) => {
      if (existingMemberIds.has(r.daliMemberId)) return false;
      if (role === "InDomain") return r.domainId === applicantDomainId;
      return r.domainId !== applicantDomainId;
    });

    const freeAndSorted = candidates
      .filter((r) => {
        const check: InterviewerFreeCheck = {
          cycleInterviewerId: r.id,
          daliMemberId: r.daliMemberId,
          domainId: r.domainId,
          availability: r.availabilityBlocks.map((b) => ({
            startTime: b.startTime,
            endTime: b.endTime,
          })),
          bookedIntervals: memberIntervals.get(r.daliMemberId) ?? [],
        };
        return isInterviewerFree(check, interview.startTime, interview.endTime);
      })
      .sort(
        (a, b) =>
          (memberActiveCount.get(a.daliMemberId) ?? 0) -
          (memberActiveCount.get(b.daliMemberId) ?? 0),
      );

    if (freeAndSorted.length === 0) {
      // No replacement available. Throw so the outer transaction rolls back
      // — the declining assignment has NOT been updated yet, so rollback
      // leaves it Active exactly as it was.
      throw new Error(REPLACEMENT_UNAVAILABLE);
    }

    // Commit the atomic swap: mark old as Declined, create new Active.
    await tx.interviewAssignment.update({
      where: { id: decliningAssignmentId },
      data: { status: "Declined" },
    });
    const created = await tx.interviewAssignment.create({
      data: {
        interviewId: interview.id,
        cycleInterviewerId: freeAndSorted[0].id,
        role,
        status: "Active",
      },
    });
    return { reassigned: true as const, newInterviewerId: created.cycleInterviewerId };
  });
}

export function isNoReplacementError(error: unknown): boolean {
  return error instanceof Error && error.message === REPLACEMENT_UNAVAILABLE;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function isInterviewerFree(
  interviewer: InterviewerFreeCheck,
  slotStart: Date,
  slotEnd: Date,
): boolean {
  // Must have at least one availability block covering the entire slot
  const covered = interviewer.availability.some(
    (a) => a.startTime <= slotStart && a.endTime >= slotEnd,
  );
  if (!covered) return false;

  // Must not have any booked interval overlapping the slot
  const conflict = interviewer.bookedIntervals.some(
    (b) => b.start < slotEnd && b.end > slotStart,
  );
  return !conflict;
}

/** @deprecated Use isInterviewerFree instead */
export const isReviewerFree = isInterviewerFree;

export function generateCandidateSlots(
  startDate: Date,
  endDate: Date,
  dayStartHour: number,
  dayEndHour: number,
  slotDurationMinutes: number,
  timezone: string,
): Date[] {
  const slots: Date[] = [];
  const current = new Date(startDate);

  while (current <= endDate) {
    const dayStr = current.toLocaleDateString("en-CA", { timeZone: timezone }); // YYYY-MM-DD

    for (let hour = dayStartHour; hour < dayEndHour; hour++) {
      for (let minute = 0; minute < 60; minute += 15) {
        const slotStart = parseTzDateTime(dayStr, hour, minute, timezone);
        const slotEnd = new Date(slotStart.getTime() + slotDurationMinutes * 60_000);

        const slotEndLocal = new Date(slotEnd.toLocaleString("en-US", { timeZone: timezone }));
        if (slotEndLocal.getHours() > dayEndHour || (slotEndLocal.getHours() === dayEndHour && slotEndLocal.getMinutes() > 0)) {
          continue;
        }

        const dayOfWeek = new Date(slotStart.toLocaleString("en-US", { timeZone: timezone })).getDay();
        if (dayOfWeek === 0 || dayOfWeek === 6) continue;

        if (slotStart > new Date()) {
          slots.push(slotStart);
        }
      }
    }

    current.setDate(current.getDate() + 1);
  }

  return slots;
}

/** Parse a date + hour + minute in a specific timezone into a UTC Date */
function parseTzDateTime(dateStr: string, hour: number, minute: number, timezone: string): Date {
  const pad = (n: number) => String(n).padStart(2, "0");
  const fakeLocal = `${dateStr}T${pad(hour)}:${pad(minute)}:00`;

  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  const utcGuess = new Date(fakeLocal + "Z");
  const parts = formatter.formatToParts(utcGuess);
  const get = (type: string) => parseInt(parts.find((p) => p.type === type)?.value ?? "0");
  // Use Date.UTC so the comparison is timezone-independent (new Date(y,m,d,...)
  // uses the system timezone, which breaks when it matches the target timezone).
  const localAtUtcMs = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  const offsetMs = localAtUtcMs - utcGuess.getTime();

  return new Date(utcGuess.getTime() - offsetMs);
}
