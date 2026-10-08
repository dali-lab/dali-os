/**
 * Backfill RoomBooking rows for in-person interviews that got a roomId
 * before Interview.roomId actually booked a room (migration
 * 20261008120000_interview_room_bookings carried the old PodAppa/PodMomo
 * enum over to roomId but couldn't book anything retroactively). Gives every
 * still-upcoming Scheduled interview a real RoomBooking so /rooms and the
 * door displays see it.
 *
 * Idempotent: only touches interviews with roomBookingId still null. Safe to
 * re-run — already-booked rows are skipped.
 *
 * Usage:
 *   npx tsx scripts/backfill-interview-room-bookings.ts
 */

import { prisma } from "../app/lib/db.js";
import { createRoomBooking } from "../app/lib/rooms.server.js";

async function main() {
  const interviews = await prisma.interview.findMany({
    where: {
      status: "Scheduled",
      roomId: { not: null },
      roomBookingId: null,
      startTime: { gt: new Date() },
    },
    select: {
      id: true,
      roomId: true,
      applicationCycleId: true,
      startTime: true,
      endTime: true,
      assignments: {
        where: { role: "InDomain", status: "Active" },
        select: { cycleInterviewer: { select: { userId: true } } },
      },
    },
  });

  console.log(`${interviews.length} scheduled interview(s) missing a room booking.`);
  let booked = 0;
  let failed = 0;

  for (const iv of interviews) {
    const userId = iv.assignments[0]?.cycleInterviewer.userId;
    if (!userId) {
      failed++;
      console.warn(`  fail ${iv.id} — no active in-domain interviewer to book under`);
      continue;
    }
    const result = await createRoomBooking({
      roomId: iv.roomId!,
      userId,
      start: iv.startTime,
      end: iv.endTime,
      title: "Interview",
      source: "Interview",
      applicationCycleId: iv.applicationCycleId,
    });
    if (result.ok) {
      await prisma.interview.update({
        where: { id: iv.id },
        data: { roomBookingId: result.value.id },
      });
      booked++;
      console.log(`  booked ${iv.id} -> room booking ${result.value.id}`);
    } else {
      failed++;
      console.warn(`  fail ${iv.id} — ${result.error}`);
    }
  }

  console.log(`\nDone. ${booked} booked, ${failed} failed.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
