// One-way mirror of work TimeEntry rows to a dedicated "DALI Timesheet" Google
// calendar on the user's DALI (@dali.dartmouth.edu) Google link.
//
// Architecture mirrors member-class.server.ts exactly:
//   - Postgres TimeEntry is the source of truth for payroll.
//   - Google is a best-effort read view ("my paid hours, portable").
//   - Google failures are swallowed (logged, never thrown to callers).
//   - The calendar is deliberately NOT subscribed into DALI's own external
//     layer — DALI renders paid hours via the logged-time layer, so showing the
//     Google mirror there too would duplicate every block. It's a portable view
//     for the user's Google Calendar, off their primary.
//
// Entry points for the route wiring (calendar.server.ts time-entry handlers):
//   on create  → await syncTimeEntryToGoogle(entry)
//   on update  → await syncTimeEntryToGoogle(entry)   // patches if already mirrored
//   on delete  → await removeTimeEntryFromGoogle(entry)

import { prisma } from "~/lib/db";
import {
  createGoogleCalendarEvent,
  deleteGoogleCalendarEvent,
  getOrCreateNamedCalendar,
  patchGoogleCalendarEvent,
} from "~/lib/google-calendar";
import { getRoleLabel } from "~/lib/roles";
import { APPLICATION_TZ } from "~/lib/timezone";

const TIMESHEET_CALENDAR_NAME = "DALI Timesheet";

// ── Result types ────────────────────────────────────────────────────────────

export type EnableSyncResult =
  | { ok: true }
  | { ok: false; reason: "needsDaliLink" }
  | { ok: false; reason: "error"; message: string };

// ── Helpers (private) ────────────────────────────────────────────────────────

/** The subset of columns this module writes — plain values so the same patch is
 *  valid for both `create` and `update` (the generated `update` type otherwise
 *  admits FieldUpdateOperations, which aren't assignable to `create`). */
type TimesheetSettingsPatch = {
  timesheetGoogleSync?: boolean;
  timesheetCalendarLinkId?: string | null;
  timesheetCalendarId?: string | null;
};

/** Lazily upsert the UserAvailabilitySettings row. */
async function upsertAvailabilitySettings(userId: string, data: TimesheetSettingsPatch) {
  await prisma.userAvailabilitySettings.upsert({
    where: { userId },
    create: { userId, ...data },
    update: data,
  });
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Whether the user has opted in to the DALI Timesheet Google sync.
 * Returns false when no UserAvailabilitySettings row exists (the default).
 */
export async function getUserTimesheetSyncEnabled(userId: string): Promise<boolean> {
  const settings = await prisma.userAvailabilitySettings.findUnique({
    where: { userId },
    select: { timesheetGoogleSync: true },
  });
  return settings?.timesheetGoogleSync ?? false;
}

/**
 * Enable or disable the DALI Timesheet Google sync for a user.
 *
 * On enable:
 *   1. Find the user's DALI Google link (provider=Google,
 *      externalEmail ending "@dali.dartmouth.edu", enabled=true).
 *   2. If none exists, return { ok: false, reason: "needsDaliLink" } — the caller
 *      should redirect the user to connect their DALI Google account first
 *      (reuse the OAuth start flow with loginHint = user.daliEmail).
 *   3. Lazily `getOrCreateNamedCalendar` on that link, persist the coords, and
 *      `ensureCalendarVisible` so it appears in the external layer immediately.
 *
 * On disable: clears the flag but keeps timesheetCalendarLinkId/timesheetCalendarId
 * (so re-enabling later reuses the same calendar without recreating it).
 */
export async function setUserTimesheetSync(
  userId: string,
  enabled: boolean,
): Promise<EnableSyncResult> {
  if (!enabled) {
    await upsertAvailabilitySettings(userId, { timesheetGoogleSync: false });
    return { ok: true };
  }

  // Resolve the user's DALI Google link.
  const daliLink = await prisma.userCalendarLink.findFirst({
    where: {
      userId,
      provider: "Google",
      enabled: true,
      externalEmail: { endsWith: "@dali.dartmouth.edu" },
    },
    select: { id: true },
  });

  if (!daliLink) {
    return { ok: false, reason: "needsDaliLink" };
  }

  try {
    const calendarId = await getOrCreateNamedCalendar(daliLink.id, TIMESHEET_CALENDAR_NAME);
    // Intentionally NOT subscribed into DALI's own calendar layer: the Timesheet
    // calendar is a Google-side view of paid hours ("portable, off my primary"),
    // while DALI already renders those hours natively via the logged-time layer.
    // Surfacing the mirror inside DALI would double every logged block.
    await upsertAvailabilitySettings(userId, {
      timesheetGoogleSync: true,
      timesheetCalendarLinkId: daliLink.id,
      timesheetCalendarId: calendarId,
    });
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[timesheet-mirror] setUserTimesheetSync failed:", message);
    return { ok: false, reason: "error", message };
  }
}

/**
 * Shape of a TimeEntry row the callers pass into syncTimeEntryToGoogle /
 * removeTimeEntryFromGoogle. Only the fields this module needs — callers should
 * spread or pick from their full Prisma TimeEntry result.
 */
export interface TimesheetEntryInput {
  id: string;
  userId: string;
  assignmentType: string | null;
  roleRefId: string | null;
  note: string | null;
  startTime: Date | null;
  endTime: Date | null;
  googleTimesheetEventId?: string | null;
  googleTimesheetLinkId?: string | null;
}

/**
 * Mirror a work TimeEntry to the user's DALI Timesheet Google calendar.
 *
 * No-ops when:
 *   - The user's timesheetGoogleSync flag is off.
 *   - The entry has no startTime/endTime (not a timed entry — shows in the ledger
 *     list but not on the grid, so there is nothing useful to push to Google).
 *   - The entry has no role attribution (assignmentType/roleRefId null) — these
 *     are legacy/unattributed rows with no meaningful summary to show.
 *
 * Creates a new Google event on first call for an entry; patches it on subsequent
 * calls (when googleTimesheetEventId is already set). Persists
 * googleTimesheetEventId + googleTimesheetLinkId back on the TimeEntry row so the
 * next update knows where the event lives.
 *
 * Best-effort: Google failures are swallowed (logged). The caller's Postgres write
 * must already have succeeded before this is called.
 *
 * Wiring point (calendar.server.ts):
 *   After `prisma.timeEntry.create(...)` or `prisma.timeEntry.update(...)`:
 *     await syncTimeEntryToGoogle(entry).catch(() => {});
 *   (The `.catch(() => {})` is belt-and-suspenders — the function already
 *   swallows all Google errors internally.)
 */
export async function syncTimeEntryToGoogle(entry: TimesheetEntryInput): Promise<void> {
  // Gate 1: sync must be on.
  const settings = await prisma.userAvailabilitySettings.findUnique({
    where: { userId: entry.userId },
    select: {
      timesheetGoogleSync: true,
      timesheetCalendarLinkId: true,
      timesheetCalendarId: true,
    },
  });
  if (!settings?.timesheetGoogleSync) return;
  if (!settings.timesheetCalendarLinkId || !settings.timesheetCalendarId) return;

  // Gate 2: must have a precise time range.
  if (!entry.startTime || !entry.endTime) return;

  // Gate 3: must have a role to produce a meaningful summary.
  if (!entry.assignmentType || !entry.roleRefId) return;

  const linkId = settings.timesheetCalendarLinkId;
  const calendarId = settings.timesheetCalendarId;

  // Resolve the role label for the event summary (best-effort: falls back to "Work").
  let roleLabel = "Work";
  try {
    const resolved = await getRoleLabel(
      entry.assignmentType as Parameters<typeof getRoleLabel>[0],
      entry.roleRefId,
    );
    if (resolved) roleLabel = resolved;
  } catch {
    /* best-effort */
  }

  const summary = roleLabel;
  const description = entry.note ?? undefined;
  const startIso = entry.startTime.toISOString();
  const endIso = entry.endTime.toISOString();
  const timeZone = APPLICATION_TZ;

  try {
    if (entry.googleTimesheetEventId) {
      // Patch the existing mirror event.
      await patchGoogleCalendarEvent({
        linkId,
        calendarId,
        eventId: entry.googleTimesheetEventId,
        summary,
        description,
        startIso,
        endIso,
        timeZone,
      });
      // linkId is already correct; no need to re-persist.
    } else {
      // Create a new mirror event.
      const { eventId } = await createGoogleCalendarEvent({
        linkId,
        calendarId,
        summary,
        description,
        startIso,
        endIso,
        timeZone,
        attendees: [],
      });
      // Persist the Google event id back so future updates can patch it.
      await prisma.timeEntry.update({
        where: { id: entry.id },
        data: {
          googleTimesheetEventId: eventId,
          googleTimesheetLinkId: linkId,
        },
      });
    }
  } catch (err) {
    // Swallow Google errors — the Postgres row is already committed.
    // Mirror the classes code: orphaned/stale Google events are preferable to
    // blocking the user's timesheet write.
    console.error(
      "[timesheet-mirror] syncTimeEntryToGoogle failed for entry",
      entry.id,
      ":",
      err instanceof Error ? err.message : err,
    );
  }
}

/**
 * Delete the Google mirror event for a TimeEntry that is being removed.
 *
 * No-ops when googleTimesheetEventId is absent (entry was never mirrored).
 * Best-effort: Google failures are swallowed.
 *
 * Wiring point (calendar.server.ts):
 *   Before (or after — best-effort) `prisma.timeEntry.delete(...)`:
 *     await removeTimeEntryFromGoogle(entry).catch(() => {});
 */
export async function removeTimeEntryFromGoogle(entry: TimesheetEntryInput): Promise<void> {
  if (!entry.googleTimesheetEventId || !entry.googleTimesheetLinkId) return;

  // Look up the stored calendarId so we delete from the right sub-calendar.
  // Fall back gracefully if the settings row is gone.
  let calendarId: string | undefined;
  try {
    const settings = await prisma.userAvailabilitySettings.findUnique({
      where: { userId: entry.userId },
      select: { timesheetCalendarId: true },
    });
    calendarId = settings?.timesheetCalendarId ?? undefined;
  } catch {
    /* best-effort — proceed without calendarId */
  }

  try {
    await deleteGoogleCalendarEvent({
      linkId: entry.googleTimesheetLinkId,
      calendarId,
      eventId: entry.googleTimesheetEventId,
    });
  } catch (err) {
    // Swallow — orphaned Google event is preferable to blocking the Postgres delete.
    console.error(
      "[timesheet-mirror] removeTimeEntryFromGoogle failed for entry",
      entry.id,
      ":",
      err instanceof Error ? err.message : err,
    );
  }
}
