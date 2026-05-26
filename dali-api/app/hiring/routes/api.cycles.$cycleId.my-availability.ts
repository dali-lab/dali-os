import type { Route } from "./+types/api.cycles.$cycleId.my-availability";
import { z } from "zod";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { withCors, handlePreflight } from "~/lib/cors";
import { parseJson } from "~/lib/validate";
import { zonedDayStartUtc } from "~/lib/timezone";

const AvailabilitySchema = z.object({
  blocks: z
    .array(
      z
        .object({
          startTime: z.string().datetime({ offset: true }),
          endTime: z.string().datetime({ offset: true }),
        })
        .refine((b) => new Date(b.endTime) > new Date(b.startTime), {
          message: "endTime must be after startTime",
        }),
    )
    .max(500)
    .default([]),
});

/** UTC bounds [start, end) of the configured interview window in `timezone`.
 * The stored `interviewStartDate`/`interviewEndDate` are UTC-midnight stamps
 * that stand for plain calendar dates (the picker sends a date-only value), so
 * we read their Y/M/D in UTC — NOT in `timezone`, which would shift the date to
 * the previous day for any zone west of UTC and slide the whole window off by a
 * day. We then anchor midnight-on-startDate and midnight-on-(endDate+1) in the
 * configured timezone. */
function interviewWindowUtcBounds(config: {
  interviewStartDate: Date;
  interviewEndDate: Date;
  timezone: string;
}): { start: Date; end: Date } {
  const s = config.interviewStartDate;
  const e = config.interviewEndDate;
  const start = zonedDayStartUtc(
    s.getUTCFullYear(),
    s.getUTCMonth() + 1,
    s.getUTCDate(),
    config.timezone,
  );
  // End is exclusive — the day after `interviewEndDate`.
  const endNext = new Date(Date.UTC(e.getUTCFullYear(), e.getUTCMonth(), e.getUTCDate()));
  endNext.setUTCDate(endNext.getUTCDate() + 1);
  const end = zonedDayStartUtc(
    endNext.getUTCFullYear(),
    endNext.getUTCMonth() + 1,
    endNext.getUTCDate(),
    config.timezone,
  );
  return { start, end };
}

// Return every CycleInterviewer row the authenticated member has in this
// cycle. A member who serves multiple domains has multiple rows; availability
// is a per-human concept, so writes fan out across every row.
async function findCycleInterviewers(userId: string, cycleId: string) {
  const member = await prisma.dALIMember.findUnique({ where: { userId } });
  if (!member) return [];
  return prisma.cycleInterviewer.findMany({
    where: { userId, applicationCycleId: cycleId },
    select: { id: true },
  });
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);

  const interviewers = await findCycleInterviewers(auth.user.sub, params.cycleId!);
  if (interviewers.length === 0) {
    return withCors(request, Response.json([]));
  }

  // All of the member's rows should hold the same availability set after a
  // PUT, so reading from any of them gives the canonical view. Read from
  // the first row for simplicity.
  const blocks = await prisma.interviewerAvailability.findMany({
    where: { cycleInterviewerId: interviewers[0].id },
    orderBy: { startTime: "asc" },
  });

  return withCors(request, Response.json(blocks));
}

export async function action({ request, params }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  if (request.method !== "PUT") {
    return withCors(request, Response.json({ error: "Method not allowed" }, { status: 405 }));
  }

  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);

  const interviewers = await findCycleInterviewers(auth.user.sub, params.cycleId!);
  if (interviewers.length === 0) {
    return withCors(request, Response.json({ error: "Not an interviewer for this cycle" }, { status: 404 }));
  }

  const body = await parseJson(request, AvailabilitySchema);
  if (body instanceof Response) return withCors(request, body);
  const parsedBlocks = body.blocks.map((b) => ({
    startTime: new Date(b.startTime),
    endTime: new Date(b.endTime),
  }));

  // Clip blocks to the configured interview window. Without this, a stale
  // calendar (e.g. cached availability from a prior cycle, or a client whose
  // grid bounds drifted) can save blocks that the scheduler will silently
  // discard, leaving applicants with "no slots available".
  const config = await prisma.interviewConfig.findUnique({
    where: { applicationCycleId: params.cycleId },
  });
  const validBlocks = config
    ? (() => {
        const { start, end } = interviewWindowUtcBounds(config);
        return parsedBlocks.filter(
          (b) => b.startTime >= start && b.endTime <= end,
        );
      })()
    : parsedBlocks;

  // Full replacement applied across EVERY row the member has in this cycle.
  // Fans the same availability set out to each CycleInterviewer so reads
  // from the scheduler and from the "Interviewers for this Domain" panel
  // agree, regardless of which row Prisma returns first.
  await prisma.$transaction(async (tx) => {
    for (const interviewer of interviewers) {
      await tx.interviewerAvailability.deleteMany({
        where: { cycleInterviewerId: interviewer.id },
      });
      if (validBlocks.length > 0) {
        await tx.interviewerAvailability.createMany({
          data: validBlocks.map((b) => ({
            cycleInterviewerId: interviewer.id,
            startTime: b.startTime,
            endTime: b.endTime,
          })),
        });
      }
    }
  });

  const updated = await prisma.interviewerAvailability.findMany({
    where: { cycleInterviewerId: interviewers[0].id },
    orderBy: { startTime: "asc" },
  });

  return withCors(request, Response.json(updated));
}
