// Interview times anchor to Eastern Time (Dartmouth), which is where in-person
// interviews physically happen. Applicant-facing views show a DUAL time — the ET
// anchor plus the applicant's own local time — so a traveling/remote applicant
// can read either without misjudging an in-person start. Interviewer-facing
// views (interviewers are logged-in members) render in the interviewer's own
// zone. The ET-only formatters below back the applicant EMAIL templates, whose
// {{time}} contract is documented as Eastern.

import {
  APPLICATION_TZ as EASTERN_TZ,
  formatInTimeZone,
  formatDualTime,
  isValidTimezone,
} from "~/lib/timezone";

export const INTERVIEW_TIMEZONE_LABEL = "ET";

function formatTime(iso: string | Date): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
    timeZone: EASTERN_TZ,
  });
}

function zoneAbbrev(iso: string | Date, tz: string): string {
  return (
    new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "short" })
      .formatToParts(new Date(iso))
      .find((p) => p.type === "timeZoneName")?.value ?? ""
  );
}

export function formatInterviewDate(iso: string | Date): string {
  return new Date(iso).toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: EASTERN_TZ,
  });
}

export function formatInterviewTime(iso: string | Date): string {
  return `${formatTime(iso)} ${INTERVIEW_TIMEZONE_LABEL}`;
}

export function formatInterviewTimeRange(
  startIso: string | Date,
  endIso: string | Date,
  separator: string = " - ",
): string {
  return `${formatTime(startIso)}${separator}${formatTime(endIso)} ${INTERVIEW_TIMEZONE_LABEL}`;
}

// ── Interviewer-facing: render in the interviewer's own zone ──────────────────

/** Interview date rendered in `tz` (interviewer's own zone). */
export function formatInterviewDateInZone(iso: string | Date, tz: string): string {
  return formatInTimeZone(iso, tz, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

/** "10:00 AM - 10:30 AM EDT" rendered in `tz` (interviewer's own zone). */
export function formatInterviewTimeRangeInZone(
  startIso: string | Date,
  endIso: string | Date,
  tz: string,
  separator: string = " - ",
): string {
  const start = formatInTimeZone(startIso, tz, { hour: "numeric", minute: "2-digit" });
  const end = formatInTimeZone(endIso, tz, { hour: "numeric", minute: "2-digit" });
  const abbrev = zoneAbbrev(startIso, tz);
  return `${start}${separator}${end}${abbrev ? ` ${abbrev}` : ""}`;
}

// ── Applicant-facing: ET anchor plus the applicant's own local time ───────────

/**
 * "10:00 AM - 10:30 AM ET · 7:00 AM - 7:30 AM your time (PDT)". Collapses to the
 * ET-only range when the applicant's zone is unknown or resolves to ET.
 */
export function formatInterviewTimeRangeDual(
  startIso: string | Date,
  endIso: string | Date,
  viewerTz: string | null | undefined,
  separator: string = " - ",
): string {
  const et = formatInterviewTimeRange(startIso, endIso, separator);
  if (!isValidTimezone(viewerTz) || viewerTz === EASTERN_TZ) return et;
  // Skip the second half if the applicant's clock reads identically to ET.
  if (formatDualTime(startIso, viewerTz, EASTERN_TZ) === formatDualTime(startIso, EASTERN_TZ, EASTERN_TZ)) {
    return et;
  }
  const vStart = formatInTimeZone(startIso, viewerTz, { hour: "numeric", minute: "2-digit" });
  const vEnd = formatInTimeZone(endIso, viewerTz, { hour: "numeric", minute: "2-digit" });
  const abbrev = zoneAbbrev(startIso, viewerTz);
  return `${et} · ${vStart}${separator}${vEnd} your time${abbrev ? ` (${abbrev})` : ""}`;
}
