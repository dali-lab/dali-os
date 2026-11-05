import type { APIRequestContext } from '@playwright/test';
import pg from 'pg';

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://dali:dali@localhost:5432/dali';

export const ORGANIZER = { email: 'jordan.taylor@dali.dartmouth.edu', name: 'Jordan Taylor' };
export const GUEST = { email: 'eng.lead@dali.dartmouth.edu', name: 'Mira Chen' };
export const OUTSIDER = { email: 'priya.raman@dali.dartmouth.edu', name: 'Priya Raman' };
export const ROOM = { id: 'room_pod_appa', name: 'Pod Appa' };

export function randomId() {
  return Math.random().toString(36).slice(2, 8);
}

/** A weekday 14-85 days out as YYYY-MM-DD (room bookings open 90 days ahead), away from the seed and other specs. */
export function farDay(): string {
  for (;;) {
    const d = new Date(Date.now() + (14 + Math.floor(Math.random() * 71)) * 86_400_000);
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) return d.toISOString().slice(0, 10);
  }
}

/** UTC instant on `day` at hh:mm. The specs pin the browser to UTC, so this is also the local wall clock. */
export const at = (day: string, hhmm: string) => new Date(`${day}T${hhmm}:00.000Z`).toISOString();

export async function withDb<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client(DATABASE_URL);
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

export async function userId(email: string) {
  return withDb(async (c) => (await c.query('SELECT id FROM "User" WHERE "daliEmail" = $1', [email])).rows[0].id as string);
}

/**
 * Create a DALI-only meeting as the signed-in `request` user. The calendar composer needs a
 * linked, writable Google calendar, which e2e never has, so setup goes through the same API
 * the composer posts to.
 */
export async function createMeeting(
  request: APIRequestContext,
  opts: { title: string; guestId: string; startIso: string; minutes?: number; roomIds?: string[] },
) {
  const res = await request.post('/api/scheduled-meetings', {
    data: {
      scopeType: 'UserList',
      participantUserIds: [opts.guestId],
      title: opts.title,
      durationMinutes: opts.minutes ?? 60,
      startTime: opts.startIso,
      roomIds: opts.roomIds ?? [],
      location: opts.roomIds?.length ? ROOM.name : undefined,
      note: false,
    },
  });
  if (res.status() !== 201) throw new Error(`createMeeting ${res.status()}: ${await res.text()}`);
  const json = await res.json();
  return json.meeting.id as string;
}

/** Remove everything a spec created, keyed by the unique title/note suffix. */
export async function cleanup(suffix: string) {
  await withDb(async (c) => {
    const like = `%${suffix}%`;
    const meetings = (await c.query('SELECT id FROM "ScheduledMeeting" WHERE title LIKE $1', [like])).rows.map((r) => r.id);
    await c.query('DELETE FROM "TimeEntry" WHERE note LIKE $1 OR "scheduledMeetingId" = ANY($2)', [like, meetings]);
    await c.query('DELETE FROM "RoomBooking" WHERE title LIKE $1', [like]);
    for (const table of ['MeetingAttendance', 'Notification', 'MeetingReminderLog', 'MeetingException', 'MeetingShareGrant']) {
      await c.query(`DELETE FROM "${table}" WHERE "scheduledMeetingId" = ANY($1)`, [meetings]);
    }
    await c.query('DELETE FROM "_RoomToScheduledMeeting" WHERE "B" = ANY($1)', [meetings]);
    await c.query('DELETE FROM "ScheduledMeeting" WHERE id = ANY($1)', [meetings]);
  });
}
