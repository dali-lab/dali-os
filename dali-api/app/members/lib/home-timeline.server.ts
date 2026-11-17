import { prisma } from "~/lib/db.server";
import { listUpcomingMeetings } from "~/calendar/lib/upcoming-meetings-list.server";
import { meetingOccurrenceHref } from "~/calendar/lib/meeting-href";
import { fullName } from "~/lib/display";
import type { TimelineEvent, TimelineProjects } from "~/components/home/timeline/term-timeline";

export const TIMELINE_EVENT_LIMIT = 3;
const DALI_WINDOW_DAYS = 90;

export async function loadHomeEvents(
  viewer: { id: string; isAlumni: boolean },
  now: Date = new Date(),
): Promise<TimelineEvent[]> {
  const [rows, meetings, me] = await Promise.all([
    prisma.communityEvent.findMany({
      where: {
        cancelledAt: null,
        endsAt: { gte: now },
        ...(viewer.isAlumni ? {} : { audience: "alumni_and_students" }),
      },
      orderBy: { startsAt: "asc" },
      take: TIMELINE_EVENT_LIMIT,
      select: {
        id: true,
        title: true,
        startsAt: true,
        online: true,
        placeName: true,
        host: { select: { firstName: true, lastName: true } },
        rsvps: { select: { userId: true, user: { select: { classYear: true } } } },
      },
    }),
    listUpcomingMeetings(viewer.id, now, new Date(now.getTime() + DALI_WINDOW_DAYS * 86_400_000)),
    prisma.user.findUnique({ where: { id: viewer.id }, select: { classYear: true } }),
  ]);

  const alumni = rows.map((r): TimelineEvent => {
    const others = r.rsvps.filter((g) => g.userId !== viewer.id);
    return {
      id: r.id,
      source: "alumni",
      title: r.title,
      startsAt: r.startsAt.toISOString(),
      hostName: fullName(r.host) || null,
      location: r.online ? "Online" : r.placeName,
      goingCount: r.rsvps.length,
      classmates:
        me?.classYear == null ? 0 : others.filter((g) => g.user.classYear === me.classYear).length,
      viewerGoing: r.rsvps.some((g) => g.userId === viewer.id),
      href: null,
    };
  });

  const dali = meetings
    .filter((m) => m.source === "dali")
    .map(
      (m): TimelineEvent => ({
        id: `dali:${m.id}:${m.occurrenceStart}`,
        source: "dali",
        title: m.title,
        startsAt: m.startsAt,
        hostName: null,
        location: m.location ?? (m.meetingUrl ? "Online" : null),
        goingCount: m.attendeeCount,
        classmates: 0,
        viewerGoing: false,
        href: meetingOccurrenceHref(m.id, m.occurrenceStart),
      }),
    );

  return [...alumni, ...dali]
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
    .slice(0, TIMELINE_EVENT_LIMIT);
}

export async function loadTermProjects(userId: string, termId: string): Promise<TimelineProjects> {
  const [count, mine] = await Promise.all([
    prisma.projectTerm.count({ where: { termId } }),
    prisma.projectAssignment.findFirst({
      where: { userId, termId: { not: termId }, project: { projectTerms: { some: { termId } } } },
      orderBy: { createdAt: "desc" },
      select: { project: { select: { name: true } } },
    }),
  ]);
  return { count, oldProject: mine?.project.name ?? null };
}
