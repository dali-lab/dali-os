// Pure layer builders for the unified calendar.
//
// Each builder turns loader data into positioned EventBlocks, bucketed by day
// column, using the exact placement logic the legacy per-tab grids use. The
// unified screen toggles layers on/off and merges the enabled ones into one
// WeekGrid — so "personal blocks", "linked (Google) calendars", "meetings" and
// "logged time" become toggleable colored layers instead of separate tabs.
//
// Builders are range-agnostic: they place blocks into whatever `days` array
// they're given (7 for a week, 1 for a day, a full month for the month grid),
// so the same functions feed every view.

import { getZonedYMD, zonedDayStartUtc } from "~/lib/timezone";
import type { EventBlock, ExternalEventDTO, LoaderData, TimeEntryDTO } from "./types";
import {
  EVENT_CORAL,
  UNASSIGNED_ROLE_KEY,
  nominalDayRange,
  roleColor,
  timeEntryRoleKey,
} from "./event-block";

/** One column of the grid — a single calendar day, in UTC-anchored form. */
export type GridDay = { dayOfWeek: number; num: number; dateUtc: Date };

/** The toggleable layers, in panel order. "workingHours" is a background layer
 *  (stripes), handled separately from these event layers. */
export type LayerKey = "external" | "logged";

export type LayerVisibility = Record<LayerKey, boolean> & { workingHours: boolean };

export const DEFAULT_LAYER_VISIBILITY: LayerVisibility = {
  workingHours: true,
  external: true,
  // Logged time is the niche, retrospective view — off until you ask for it.
  logged: false,
};

/** Build the day columns for a view: `count` consecutive days from `startIso`
 *  (midnight-aligned UTC instants, matching the loader's week window). */
export function buildGridDays(startIso: string, count: number): GridDay[] {
  const start = new Date(startIso);
  return Array.from({ length: count }).map((_, i) => {
    const d = new Date(start.getTime() + i * 86_400_000);
    return { dayOfWeek: d.getUTCDay(), num: d.getUTCDate(), dateUtc: d };
  });
}

/** Place one block into its day column, timezone-correct. Silently drops blocks
 *  that fall outside the visible `days`. Mirrors the legacy grids' `placeBlock`. */
export function placeBlock(
  days: GridDay[],
  timezone: string,
  startIso: string,
  endIso: string,
  block: Omit<EventBlock, "startHour" | "duration">,
  into: Record<number, EventBlock[]>,
): void {
  const start = new Date(startIso);
  const end = new Date(endIso);
  const ymd = getZonedYMD(start, timezone);
  const dayMidnight = zonedDayStartUtc(ymd.year, ymd.month, ymd.day, timezone);
  const startHour = (start.getTime() - dayMidnight.getTime()) / 3_600_000;
  const duration = (end.getTime() - start.getTime()) / 3_600_000;
  const dayIdx = days.findIndex(
    (d) =>
      d.dateUtc.getUTCFullYear() === ymd.year &&
      d.dateUtc.getUTCMonth() + 1 === ymd.month &&
      d.dateUtc.getUTCDate() === ymd.day,
  );
  if (dayIdx < 0) return;
  if (!into[dayIdx]) into[dayIdx] = [];
  into[dayIdx].push({ startHour, duration, ...block });
}

/** Resolve an ISO range to grid coordinates ({dayIdx, startHour, endHour}) —
 *  the inverse of placeBlock, for anchoring an editor on an existing block. */
export function toGridRange(
  days: GridDay[],
  timezone: string,
  startIso: string,
  endIso: string,
): { dayIdx: number; startHour: number; endHour: number } {
  const start = new Date(startIso);
  const end = new Date(endIso);
  const ymd = getZonedYMD(start, timezone);
  const dayMidnight = zonedDayStartUtc(ymd.year, ymd.month, ymd.day, timezone);
  const startHour = (start.getTime() - dayMidnight.getTime()) / 3_600_000;
  const endHour = startHour + (end.getTime() - start.getTime()) / 3_600_000;
  const dayIdx = days.findIndex(
    (d) =>
      d.dateUtc.getUTCFullYear() === ymd.year &&
      d.dateUtc.getUTCMonth() + 1 === ymd.month &&
      d.dateUtc.getUTCDate() === ymd.day,
  );
  return { dayIdx, startHour, endHour };
}

/** External (Google/Outlook) events — real titles + per-calendar colour.
 *  `hiddenCalendarIds` hides individual calendars on the grid (display only —
 *  the events are still fetched; disabling a calendar entirely is a Settings
 *  concern). */
export function buildExternalLayer(
  data: LoaderData,
  days: GridDay[],
  hiddenCalendarIds?: Set<string>,
  onEdit?: (e: ExternalEventDTO, anchor?: DOMRect) => void,
  onMoveResize?: (e: ExternalEventDTO, startHour: number, endHour: number, dayIdx?: number) => void,
  onDuplicate?: (e: ExternalEventDTO, anchor?: DOMRect) => void,
  onDelete?: (e: ExternalEventDTO) => void,
): Record<number, EventBlock[]> {
  // calendarId → human label ("Account · Primary"), for the detail popover's
  // source line.
  const calNames = new Map<string, string>();
  for (const link of data.calendarLinks) {
    if (link.provider !== "Google" || !link.subCalendars) continue;
    const account = link.displayName || link.externalEmail || "Google";
    for (const sub of link.subCalendars) {
      calNames.set(sub.id, `${account} · ${sub.primary ? "Primary" : sub.summary}`);
    }
  }
  const into: Record<number, EventBlock[]> = {};
  for (const e of data.externalEvents) {
    if (e.allDay) continue; // all-day events render in the band, not the grid
    if (hiddenCalendarIds && e.calendarId && hiddenCalendarIds.has(e.calendarId)) continue;
    const editable = e.writable && Boolean(e.eventId);
    placeBlock(
      days,
      data.timezone,
      e.startIso,
      e.endIso,
      {
        label: e.title,
        className: e.color ? "" : EVENT_CORAL,
        bgColor: e.color ?? undefined,
        borderClassName: e.color ? undefined : "border-accent-coral-light",
        location: e.location,
        description: e.description,
        organizerName: e.organizerName,
        attendees: e.attendees,
        links: e.links,
        calendarLabel: e.calendarId ? calNames.get(e.calendarId) : undefined,
        recurring: Boolean(e.recurringEventId),
        // Editable Google events (writable + flag on) get Edit / Duplicate /
        // Delete affordances in the detail popover and can be dragged.
        onEdit: onEdit && editable ? (anchor) => onEdit(e, anchor) : undefined,
        onMoveResize: onMoveResize && editable ? (s, en, di) => onMoveResize(e, s, en, di) : undefined,
        onDuplicate: onDuplicate && editable ? (anchor) => onDuplicate(e, anchor) : undefined,
        onDelete: onDelete && editable ? () => onDelete(e) : undefined,
      },
      into,
    );
  }
  return into;
}

/** Bucket all-day external events into the day columns they cover (end is
 *  exclusive, Google-style), for the grid's all-day band. Honours the same
 *  per-calendar visibility as the timed layer. */
export function buildAllDayItems(
  data: LoaderData,
  days: GridDay[],
  hiddenCalendarIds?: Set<string>,
): Record<number, ExternalEventDTO[]> {
  const into: Record<number, ExternalEventDTO[]> = {};
  for (const e of data.externalEvents) {
    if (!e.allDay) continue;
    if (hiddenCalendarIds && e.calendarId && hiddenCalendarIds.has(e.calendarId)) continue;
    const start = new Date(e.startIso).getTime();
    const end = new Date(e.endIso).getTime(); // exclusive
    days.forEach((d, idx) => {
      const dayMs = d.dateUtc.getTime();
      const nextMs = dayMs + 86_400_000;
      // The day overlaps [start, end): the event covers this column.
      if (start < nextMs && end > dayMs) {
        (into[idx] ??= []).push(e);
      }
    });
  }
  return into;
}

/** A role accent for an event that's also logged as work — the colour + total
 *  logged hours, keyed by the source event so the block can show it in place of
 *  a duplicate logged-time block. */
export type LoggedAccent = { color: string; hours: number };

/** Logged work grouped by the on-grid event it came from (a meeting), so a
 *  meeting that's *also* logged can show a role accent instead of a second
 *  overlapping block. Honours `excludedRoleKeys` — a filtered-out role
 *  annotates nothing. Colour follows the first bucket seen; hours sum. */
export function buildLoggedSourceIndex(
  data: LoaderData,
  excludedRoleKeys?: Set<string>,
): { byMeeting: Map<string, LoggedAccent> } {
  const byMeeting = new Map<string, LoggedAccent>();
  for (const t of data.timeEntries) {
    const roleKey = timeEntryRoleKey(t);
    if (excludedRoleKeys?.has(roleKey)) continue;
    if (!t.scheduledMeetingId) continue;
    const id = t.scheduledMeetingId;
    const prev = byMeeting.get(id);
    byMeeting.set(id, { color: prev?.color ?? roleColor(roleKey).dot, hours: (prev?.hours ?? 0) + t.hours });
  }
  return { byMeeting };
}

/** A time entry resolved to a concrete ISO range: its real times when set,
 *  else a nominal same-day slot so untimed entries still render somewhere. */
export function timeEntryRange(t: TimeEntryDTO, timezone: string): { startIso: string; endIso: string } {
  return t.startTime && t.endTime
    ? { startIso: t.startTime, endIso: t.endTime }
    : nominalDayRange(t.date, t.hours, timezone);
}

/** Logged-time layer — role-coloured TimeEntry blocks. `excludedRoleKeys` hides
 *  filtered role buckets; `onEntryClick` (optional) makes each block open its
 *  editor. */
export function buildLoggedTimeLayer(
  data: LoaderData,
  days: GridDay[],
  opts: {
    excludedRoleKeys?: Set<string>;
    onEntryClick?: (t: TimeEntryDTO, startIso: string, endIso: string) => void;
    /** Skip meeting-sourced entries when the meetings layer is visible — the
     *  meeting block carries a `loggedAccent` instead — so a logged meeting
     *  doesn't draw a duplicate overlapping block. Standalone (Manual) entries,
     *  and ones whose source layer is hidden, still draw. */
    suppressSourced?: { meetings: boolean };
  } = {},
): Record<number, EventBlock[]> {
  const into: Record<number, EventBlock[]> = {};
  for (const t of data.timeEntries) {
    const roleKey = timeEntryRoleKey(t);
    if (opts.excludedRoleKeys?.has(roleKey)) continue;
    if (opts.suppressSourced?.meetings && t.scheduledMeetingId) continue;
    const { startIso, endIso } = timeEntryRange(t, data.timezone);
    const color = roleColor(roleKey);
    placeBlock(
      days,
      data.timezone,
      startIso,
      endIso,
      {
        label: t.source === "Meeting" ? t.note || "Meeting" : t.note || "Time entry",
        className: color.className,
        borderClassName: color.borderClassName,
        onClick: opts.onEntryClick ? () => opts.onEntryClick!(t, startIso, endIso) : undefined,
      },
      into,
    );
  }
  return into;
}

/** Merge several layers' day-bucketed blocks into one map for a single grid. */
export function mergeLayers(...layers: Record<number, EventBlock[]>[]): Record<number, EventBlock[]> {
  const out: Record<number, EventBlock[]> = {};
  for (const layer of layers) {
    for (const [dayIdx, blocks] of Object.entries(layer)) {
      const idx = Number(dayIdx);
      if (!out[idx]) out[idx] = [];
      out[idx].push(...blocks);
    }
  }
  return out;
}

/** One swatch per enabled, coloured sub-calendar — the layer panel's color key
 *  for linked calendars. Deduped by colour. */
export function externalCalendarLegend(data: LoaderData): { swatch: string; label: string }[] {
  const legend: { swatch: string; label: string }[] = [];
  const seen = new Set<string>();
  for (const link of data.calendarLinks) {
    for (const sub of link.subCalendars ?? []) {
      if (sub.enabled && sub.color && !seen.has(sub.color)) {
        seen.add(sub.color);
        legend.push({ swatch: sub.color, label: sub.summary });
      }
    }
  }
  return legend;
}

/** One row per enabled sub-calendar (keyed by its real id) — the toggleable
 *  per-calendar visibility list under "Linked calendars". Unlike the legend
 *  this keeps the id so a calendar can be hidden on the grid individually, and
 *  isn't deduped by colour. */
export type CalendarLegendGroup = {
  /** The linked Google account this group's calendars belong to. */
  account: string;
  calendars: { id: string; label: string; color: string | null }[];
};

/** Enabled sub-calendars grouped by the account they come from, so the Calendars
 *  panel can label/disambiguate calendars when several Google accounts are
 *  linked (two "Primary"s, same-named calendars, etc.). */
export function perCalendarLegend(data: LoaderData): CalendarLegendGroup[] {
  const groups: CalendarLegendGroup[] = [];
  for (const link of data.calendarLinks) {
    const calendars = (link.subCalendars ?? [])
      .filter((sub) => sub.enabled)
      .map((sub) => ({ id: sub.id, label: sub.primary ? "Primary" : sub.summary, color: sub.color }));
    if (calendars.length) {
      groups.push({ account: link.displayName || link.externalEmail || "Google", calendars });
    }
  }
  return groups;
}

/** Role buckets present across the pay period, with hours totalled — feeds the
 *  logged-time summary rail + filter chips. Mirrors the Timesheet grid's
 *  bucketing (seed from what's drawn, total the whole period into it). */
export function computeRoleBuckets(
  data: LoaderData,
  periodEntries: TimeEntryDTO[],
  drawnEntries: TimeEntryDTO[],
): { key: string; label: string; hours: number }[] {
  const buckets = new Map<string, { key: string; label: string; hours: number }>();
  const labelFor = (t: TimeEntryDTO) => {
    const known =
      t.assignmentType && t.roleRefId
        ? data.myRoles.find((r) => r.assignmentType === t.assignmentType && r.roleRefId === t.roleRefId)
        : undefined;
    return known?.label ?? (timeEntryRoleKey(t) === UNASSIGNED_ROLE_KEY ? "Unassigned" : "Other role");
  };
  for (const t of drawnEntries) {
    const key = timeEntryRoleKey(t);
    if (!buckets.has(key)) buckets.set(key, { key, label: labelFor(t), hours: 0 });
  }
  for (const t of periodEntries) {
    const key = timeEntryRoleKey(t);
    const existing = buckets.get(key);
    if (existing) existing.hours += t.hours;
    else buckets.set(key, { key, label: labelFor(t), hours: t.hours });
  }
  return [...buckets.values()];
}
