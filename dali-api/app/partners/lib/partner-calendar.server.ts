import { randomBytes } from "node:crypto";
import { prisma } from "~/lib/db";
import { buildIcs } from "~/lib/ics";
import {
  activeProjectPartnerWhere,
  partnerHasProjectAccess,
} from "./partner-access";

// ICS delivery for partners: a personal subscribe feed (all their shared
// meetings, token-authenticated) and per-event downloads. Reuses buildIcs by
// lifting its VEVENT block, so a feed is one VCALENDAR wrapping many VEVENTs.

export async function ensureCalendarFeedToken(
  userId: string,
): Promise<string | null> {
  const pu = await prisma.partnerUser.findUnique({
    where: { userId },
    select: { calendarFeedToken: true },
  });
  if (!pu) return null;
  if (pu.calendarFeedToken) return pu.calendarFeedToken;
  const token = randomBytes(24).toString("base64url");
  await prisma.partnerUser.update({
    where: { userId },
    data: { calendarFeedToken: token },
  });
  return token;
}

type MeetingIcsRow = {
  id: string;
  title: string;
  selectedAt: Date | null;
  durationMinutes: number;
  recurrenceRule: string | null;
  ownerCalendarEmail: string;
};

function veventOf(ics: string): string {
  const i = ics.indexOf("BEGIN:VEVENT");
  const j = ics.indexOf("END:VEVENT");
  return i >= 0 && j >= 0 ? ics.slice(i, j + "END:VEVENT".length) : "";
}

function wrapFeed(vevents: string[]): string {
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//DALI Lab//DALI OS Partner Calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    ...vevents,
    "END:VCALENDAR",
  ].join("\r\n");
}

function meetingVevent(m: MeetingIcsRow): string {
  if (!m.selectedAt) return "";
  const end = new Date(m.selectedAt.getTime() + m.durationMinutes * 60_000);
  return veventOf(
    buildIcs({
      uid: `dali-partner-meeting-${m.id}`,
      method: "REQUEST",
      summary: m.title,
      startTime: m.selectedAt,
      endTime: end,
      organizer: { email: m.ownerCalendarEmail, name: "DALI OS" },
      attendees: [],
      sequence: 0,
      recurrenceRule: m.recurrenceRule,
    }),
  );
}

const ICS_SELECT = {
  id: true,
  title: true,
  selectedAt: true,
  durationMinutes: true,
  recurrenceRule: true,
  ownerCalendarEmail: true,
} as const;

// The partner's personal feed: every shared meeting across their org's active
// projects. Returns null when the token doesn't resolve (→ 404).
export async function buildPartnerFeedIcs(token: string): Promise<string | null> {
  const pu = await prisma.partnerUser.findUnique({
    where: { calendarFeedToken: token },
    select: { partnerOrgId: true },
  });
  if (!pu) return null;
  const links = await prisma.projectPartner.findMany({
    where: { partnerOrgId: pu.partnerOrgId, ...activeProjectPartnerWhere() },
    select: { projectId: true },
  });
  const projectIds = links.map((l) => l.projectId);
  if (projectIds.length === 0) return wrapFeed([]);
  const meetings = await prisma.scheduledMeeting.findMany({
    where: {
      projectId: { in: projectIds },
      partnerVisible: true,
      status: { not: "Cancelled" },
      selectedAt: { not: null },
    },
    select: ICS_SELECT,
  });
  return wrapFeed(meetings.map(meetingVevent).filter(Boolean));
}

// One meeting, access-checked for the requesting partner. Null → 404.
export async function buildSingleMeetingIcs(
  meetingId: string,
  userId: string,
): Promise<string | null> {
  const m = await prisma.scheduledMeeting.findUnique({
    where: { id: meetingId },
    select: {
      ...ICS_SELECT,
      projectId: true,
      partnerVisible: true,
      status: true,
    },
  });
  if (!m || !m.partnerVisible || !m.projectId || m.status === "Cancelled") {
    return null;
  }
  if (!(await partnerHasProjectAccess(userId, m.projectId))) return null;
  const v = meetingVevent(m);
  return v ? wrapFeed([v]) : null;
}
