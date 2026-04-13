import { prisma } from "~/lib/db";

// ─── Types ───────────────────────────────────────────────────────────────────

interface AvailableSlot {
  startTime: string; // ISO UTC
  endTime: string;   // ISO UTC
}

interface ReviewerFreeCheck {
  cycleReviewerId: string;
  domainId: string;
  availability: { startTime: Date; endTime: Date }[];
  bookedIntervals: { start: Date; end: Date }[]; // includes buffer
}

// ─── computeAvailableSlots ───────────────────────────────────────────────────
//
// Returns time windows where at least 1 in-domain reviewer AND 1 cross-domain
// reviewer are both free. Does NOT expose reviewer identities.

export async function computeAvailableSlots(
  cycleId: string,
  applicantDomainIds: string[],
): Promise<AvailableSlot[]> {
  const config = await prisma.interviewConfig.findUnique({
    where: { applicationCycleId: cycleId },
  });
  if (!config) return [];

  const { slotDurationMinutes, bufferMinutes, dayStartHour, dayEndHour, interviewStartDate, interviewEndDate, timezone } = config;

  // Load all cycle reviewers with their availability and booked interviews
  const reviewers = await prisma.cycleReviewer.findMany({
    where: { applicationCycleId: cycleId },
    include: {
      availabilityBlocks: true,
      interviewAssignments: {
        where: { status: "Active" },
        include: { interview: true },
      },
    },
  });

  // Build free-check data per reviewer
  const reviewerChecks: ReviewerFreeCheck[] = reviewers.map((r) => ({
    cycleReviewerId: r.id,
    domainId: r.domainId,
    availability: r.availabilityBlocks.map((b) => ({
      startTime: b.startTime,
      endTime: b.endTime,
    })),
    bookedIntervals: r.interviewAssignments.map((a) => ({
      start: new Date(a.interview.startTime.getTime() - bufferMinutes * 60_000),
      end: new Date(a.interview.endTime.getTime() + bufferMinutes * 60_000),
    })),
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

    const inDomainFree = reviewerChecks.some(
      (r) => applicantDomainIds.includes(r.domainId) && isReviewerFree(r, slotStart, slotEnd),
    );
    const crossDomainFree = reviewerChecks.some(
      (r) => !applicantDomainIds.includes(r.domainId) && isReviewerFree(r, slotStart, slotEnd),
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

// ─── assignReviewers ─────────────────────────────────────────────────────────
//
// Called inside a transaction when an applicant books a slot. Picks the
// least-scheduled free reviewer for each role (in-domain, cross-domain).

export async function assignReviewers(
  cycleId: string,
  applicationId: string,
  applicantDomainIds: string[],
  slotStart: Date,
  slotEnd: Date,
) {
  return prisma.$transaction(async (tx) => {
    const config = await tx.interviewConfig.findUnique({
      where: { applicationCycleId: cycleId },
    });
    if (!config) throw new Error("No interview config for this cycle");

    const { bufferMinutes } = config;

    const reviewers = await tx.cycleReviewer.findMany({
      where: { applicationCycleId: cycleId },
      include: {
        availabilityBlocks: true,
        interviewAssignments: {
          where: { status: "Active" },
          include: { interview: true },
        },
      },
    });

    const checks: (ReviewerFreeCheck & { activeCount: number })[] = reviewers.map((r) => ({
      cycleReviewerId: r.id,
      domainId: r.domainId,
      availability: r.availabilityBlocks.map((b) => ({
        startTime: b.startTime,
        endTime: b.endTime,
      })),
      bookedIntervals: r.interviewAssignments.map((a) => ({
        start: new Date(a.interview.startTime.getTime() - bufferMinutes * 60_000),
        end: new Date(a.interview.endTime.getTime() + bufferMinutes * 60_000),
      })),
      activeCount: r.interviewAssignments.length,
    }));

    // Find least-scheduled free in-domain reviewer
    const inDomainCandidates = checks
      .filter((r) => applicantDomainIds.includes(r.domainId) && isReviewerFree(r, slotStart, slotEnd))
      .sort((a, b) => a.activeCount - b.activeCount);

    if (inDomainCandidates.length === 0) {
      throw new Error("No in-domain reviewer available for this slot");
    }

    // Find least-scheduled free cross-domain reviewer
    const crossDomainCandidates = checks
      .filter((r) => !applicantDomainIds.includes(r.domainId) && isReviewerFree(r, slotStart, slotEnd))
      .sort((a, b) => a.activeCount - b.activeCount);

    if (crossDomainCandidates.length === 0) {
      throw new Error("No cross-domain reviewer available for this slot");
    }

    const interview = await tx.interview.create({
      data: {
        applicationId,
        applicationCycleId: cycleId,
        startTime: slotStart,
        endTime: slotEnd,
        status: "Scheduled",
        assignments: {
          create: [
            {
              cycleReviewerId: inDomainCandidates[0].cycleReviewerId,
              role: "InDomain",
              status: "Active",
            },
            {
              cycleReviewerId: crossDomainCandidates[0].cycleReviewerId,
              role: "CrossDomain",
              status: "Active",
            },
          ],
        },
      },
      include: { assignments: true },
    });

    return interview;
  });
}

// ─── reassignReviewer ────────────────────────────────────────────────────────
//
// When a reviewer declines, find the next best replacement. If none available,
// mark the interview as NeedsReassignment.

export async function reassignReviewer(
  interviewId: string,
  decliningAssignmentId: string,
) {
  return prisma.$transaction(async (tx) => {
    const assignment = await tx.interviewAssignment.findUnique({
      where: { id: decliningAssignmentId },
      include: {
        interview: { include: { assignments: true } },
        cycleReviewer: true,
      },
    });
    if (!assignment) throw new Error("Assignment not found");

    // Mark as declined
    await tx.interviewAssignment.update({
      where: { id: decliningAssignmentId },
      data: { status: "Declined" },
    });

    const { interview } = assignment;
    const config = await tx.interviewConfig.findUnique({
      where: { applicationCycleId: interview.applicationCycleId },
    });
    if (!config) throw new Error("No interview config");

    const { bufferMinutes } = config;
    const role = assignment.role;

    // Get all cycle reviewers excluding those already assigned (active or declined) to this interview
    const existingReviewerIds = interview.assignments.map((a) => a.cycleReviewerId);

    // Load the application to find the applicant's domains
    const app = await tx.application.findUnique({
      where: { id: interview.applicationId },
      include: { domainApplications: { include: { challengeVersion: true } } },
    });
    const applicantDomainIds = app?.domainApplications.map((da) => da.challengeVersion.domainId) ?? [];

    const candidates = await tx.cycleReviewer.findMany({
      where: {
        applicationCycleId: interview.applicationCycleId,
        id: { notIn: existingReviewerIds },
        // Match domain requirement based on role
        ...(role === "InDomain"
          ? { domainId: { in: applicantDomainIds } }
          : { domainId: { notIn: applicantDomainIds } }),
      },
      include: {
        availabilityBlocks: true,
        interviewAssignments: {
          where: { status: "Active" },
          include: { interview: true },
        },
      },
    });

    const freeAndSorted = candidates
      .filter((r) => {
        const check: ReviewerFreeCheck = {
          cycleReviewerId: r.id,
          domainId: r.domainId,
          availability: r.availabilityBlocks.map((b) => ({
            startTime: b.startTime,
            endTime: b.endTime,
          })),
          bookedIntervals: r.interviewAssignments.map((a) => ({
            start: new Date(a.interview.startTime.getTime() - bufferMinutes * 60_000),
            end: new Date(a.interview.endTime.getTime() + bufferMinutes * 60_000),
          })),
        };
        return isReviewerFree(check, interview.startTime, interview.endTime);
      })
      .sort((a, b) => a.interviewAssignments.length - b.interviewAssignments.length);

    if (freeAndSorted.length > 0) {
      await tx.interviewAssignment.create({
        data: {
          interviewId: interview.id,
          cycleReviewerId: freeAndSorted[0].id,
          role,
          status: "Active",
        },
      });
      return { reassigned: true, newReviewerId: freeAndSorted[0].id };
    }

    // No replacement found — flag for domain lead
    await tx.interview.update({
      where: { id: interview.id },
      data: { status: "NeedsReassignment" },
    });

    return { reassigned: false, newReviewerId: null };
  });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function isReviewerFree(
  reviewer: ReviewerFreeCheck,
  slotStart: Date,
  slotEnd: Date,
): boolean {
  // Must have at least one availability block covering the entire slot
  const covered = reviewer.availability.some(
    (a) => a.startTime <= slotStart && a.endTime >= slotEnd,
  );
  if (!covered) return false;

  // Must not have any booked interval overlapping the slot
  const conflict = reviewer.bookedIntervals.some(
    (b) => b.start < slotEnd && b.end > slotStart,
  );
  return !conflict;
}

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

  // Iterate day by day
  while (current <= endDate) {
    // Build day boundaries in the configured timezone
    const dayStr = current.toLocaleDateString("en-CA", { timeZone: timezone }); // YYYY-MM-DD

    for (let hour = dayStartHour; hour < dayEndHour; hour++) {
      for (let minute = 0; minute < 60; minute += 15) {
        // Create a date in the target timezone
        const slotStart = parseTzDateTime(dayStr, hour, minute, timezone);
        const slotEnd = new Date(slotStart.getTime() + slotDurationMinutes * 60_000);

        // Ensure the slot ends within day hours
        const slotEndLocal = new Date(slotEnd.toLocaleString("en-US", { timeZone: timezone }));
        if (slotEndLocal.getHours() > dayEndHour || (slotEndLocal.getHours() === dayEndHour && slotEndLocal.getMinutes() > 0)) {
          continue;
        }

        // Skip weekends (0 = Sunday, 6 = Saturday)
        const dayOfWeek = new Date(slotStart.toLocaleString("en-US", { timeZone: timezone })).getDay();
        if (dayOfWeek === 0 || dayOfWeek === 6) continue;

        // Only include future slots
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
  // Build an ISO-ish string and use the timezone to interpret it
  const pad = (n: number) => String(n).padStart(2, "0");
  const fakeLocal = `${dateStr}T${pad(hour)}:${pad(minute)}:00`;

  // Use Intl to find the UTC offset for this timezone at this date/time
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

  // Approximate: create a Date assuming UTC, then adjust
  const utcGuess = new Date(fakeLocal + "Z");
  const parts = formatter.formatToParts(utcGuess);
  const get = (type: string) => parseInt(parts.find((p) => p.type === type)?.value ?? "0");
  const localAtUtc = new Date(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  const offsetMs = localAtUtc.getTime() - utcGuess.getTime();

  // The actual UTC time for the desired local time
  return new Date(utcGuess.getTime() - offsetMs);
}
