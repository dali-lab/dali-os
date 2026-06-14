// Applicant-facing interview times must always render in Eastern Time so a
// traveling applicant doesn't misread the start time of an in-person interview
// at Dartmouth. Centralizing the formatter (and the timezone label) here keeps
// every applicant view consistent and protects against host-TZ regressions.

import { APPLICATION_TZ as EASTERN_TZ } from "~/lib/timezone";

export const INTERVIEW_TIMEZONE_LABEL = "ET";

function formatTime(iso: string | Date): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
    timeZone: EASTERN_TZ,
  });
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
