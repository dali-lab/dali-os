import { prisma } from "~/lib/db.server";
import { getUserRoles } from "~/lib/roles";
import { listUpcomingMeetings } from "~/lib/upcoming-meetings";
import { meetingOccurrenceHref } from "~/calendar/lib/meeting-href";
import { LAB_MEMBER_WHERE, LEGACY_DOMAIN_ID, MEMBER_LIST_ORDER_BY } from "~/lib/prisma-shapes";
import { resolvePhotoUrl } from "~/lib/photo";
import { fullName } from "~/lib/display";
import {
  HANOVER,
  activityBucket,
  locatePerson,
  whyLine,
  type CommunityPerson,
  type CommunityViewer,
  type EventAudience,
} from "~/members/lib/community";

const CORE_TEAM = "Core team";
const EVENT_WINDOW_DAYS = 90;
const MAX_EVENTS = 100;
const ATTENDEES_SHOWN = 5;

export type CommunityViewerData = CommunityViewer & {
  id: string;
  name: string;
  isAlumni: boolean;
  canHost: boolean;
  hasLocation: boolean;
};

export type CommunityFilterOptions = {
  classYears: { value: number; count: number }[];
  roles: { value: string; count: number }[];
  projects: { id: string; name: string; term: string; count: number }[];
};

export type CommunityEventAttendee = {
  id: string;
  name: string;
  photoUrl: string | null;
  reason: string | null;
};

export type CommunityEvent = {
  id: string;
  source: "alumni" | "dali";
  title: string;
  description: string | null;
  startsAt: string;
  endsAt: string;
  online: boolean;
  meetingUrl: string | null;
  placeName: string | null;
  address: string | null;
  /** Short place label: the place name, "Online", or Hanover for DALI events. */
  location: string;
  lat: number | null;
  lng: number | null;
  audience: EventAudience | null;
  notifyNearby: boolean;
  host: { id: string; name: string; photoUrl: string | null; currentJob: string | null } | null;
  hostName: string | null;
  goingCount: number;
  knownGoingCount: number;
  viewerGoing: boolean;
  /** Up to five people going, the ones the viewer knows first. */
  attendees: CommunityEventAttendee[];
  canManage: boolean;
  /** Where a DALI event opens; null for alumni events. */
  href: string | null;
};

export type CommunityData = {
  viewer: CommunityViewerData;
  people: CommunityPerson[];
  /** Alumni who have not set a location, so they have no pin. */
  unplaced: number;
  filterOptions: CommunityFilterOptions;
  events: CommunityEvent[];
};

const jobLabel = (w: { position: string; company: string } | undefined) =>
  w ? `${w.position} at ${w.company}` : null;

function tally<K>(keys: Iterable<K>): Map<K, number> {
  const counts = new Map<K, number>();
  for (const k of keys) counts.set(k, (counts.get(k) ?? 0) + 1);
  return counts;
}

export function buildFilterOptions(people: readonly CommunityPerson[]): CommunityFilterOptions {
  const classYears = [...tally(people.flatMap((p) => (p.classYear == null ? [] : [p.classYear])))]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.value - a.value);
  const roles = [...tally(people.flatMap((p) => p.roles))]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
  const projectInfo = new Map<string, { name: string; term: string }>();
  for (const p of people) for (const pr of p.projects) projectInfo.set(pr.id, pr);
  const projectCounts = tally(people.flatMap((p) => p.projects.map((pr) => pr.id)));
  const projects = [...projectCounts]
    .map(([id, count]) => ({ id, name: projectInfo.get(id)!.name, term: projectInfo.get(id)!.term, count }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { classYears, roles, projects };
}

export async function loadCommunityPeople(
  viewerId: string,
  now: Date = new Date(),
): Promise<{
  viewer: CommunityViewerData;
  people: CommunityPerson[];
  unplaced: number;
  filterOptions: CommunityFilterOptions;
  roles: Awaited<ReturnType<typeof getUserRoles>>;
}> {
  const [users, me, roles] = await Promise.all([
    prisma.user.findMany({
      where: LAB_MEMBER_WHERE,
      orderBy: MEMBER_LIST_ORDER_BY,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        photoUrl: true,
        classYear: true,
        membershipStatus: true,
        currentLocation: true,
        currentLocationLat: true,
        currentLocationLng: true,
        openToCoffeeChats: true,
        openToResumeReviews: true,
        lastActiveAt: true,
        hideActivity: true,
        workExperiences: {
          where: { endDate: null },
          orderBy: { startDate: "desc" },
          take: 1,
          select: { position: true, company: true },
        },
        projectAssignments: {
          select: {
            project: { select: { id: true, name: true } },
            term: { select: { code: true, sortKey: true } },
            domainId: true,
            domain: { select: { displayName: true } },
          },
        },
        coreAssignments: { take: 1, select: { id: true } },
      },
    }),
    prisma.user.findUnique({
      where: { id: viewerId },
      select: {
        firstName: true,
        lastName: true,
        classYear: true,
        membershipStatus: true,
        currentLocationLat: true,
        currentLocationLng: true,
        projectAssignments: { select: { projectId: true } },
      },
    }),
    getUserRoles(viewerId),
  ]);

  let unplaced = 0;
  const people: CommunityPerson[] = [];
  await Promise.all(
    users.map(async (u) => {
      const isStudent = u.membershipStatus !== "Alumni";
      const spot = locatePerson({ ...u, isStudent });
      if (!spot) {
        unplaced += 1;
        return;
      }
      const latestByProject = new Map<string, { id: string; name: string; term: string; sortKey: number }>();
      for (const a of u.projectAssignments) {
        const seen = latestByProject.get(a.project.id);
        if (!seen || a.term.sortKey > seen.sortKey) {
          latestByProject.set(a.project.id, {
            id: a.project.id,
            name: a.project.name,
            term: a.term.code,
            sortKey: a.term.sortKey,
          });
        }
      }
      const domains = [
        ...new Set(
          u.projectAssignments.filter((a) => a.domainId !== LEGACY_DOMAIN_ID).map((a) => a.domain.displayName),
        ),
      ].sort();
      people.push({
        id: u.id,
        name: fullName(u) || (isStudent ? "Student" : "Alum"),
        photoUrl: await resolvePhotoUrl(u.photoUrl),
        classYear: u.classYear,
        isStudent,
        ...spot,
        currentJob: jobLabel(u.workExperiences[0]),
        openToCoffeeChats: u.openToCoffeeChats,
        openToResumeReviews: u.openToResumeReviews,
        activity: activityBucket(u.lastActiveAt, u.hideActivity, now),
        roles: u.coreAssignments.length ? [...domains, CORE_TEAM] : domains,
        projects: [...latestByProject.values()].map(({ id, name, term }) => ({ id, name, term })),
      });
    }),
  );
  const order = new Map(users.map((u, i) => [u.id, i]));
  people.sort((a, b) => order.get(a.id)! - order.get(b.id)!);

  const viewerIsStudent = me?.membershipStatus !== "Alumni";
  const viewerSpot = me
    ? locatePerson({
        isStudent: viewerIsStudent,
        currentLocation: null,
        currentLocationLat: me.currentLocationLat,
        currentLocationLng: me.currentLocationLng,
      })
    : null;
  const viewer: CommunityViewerData = {
    id: viewerId,
    name: me ? fullName(me) : "",
    isAlumni: !viewerIsStudent,
    canHost: roles.isAlumni,
    hasLocation: me?.currentLocationLat != null && me.currentLocationLng != null,
    classYear: me?.classYear ?? null,
    projectIds: me?.projectAssignments.map((a) => a.projectId) ?? [],
    lat: viewerSpot?.lat ?? null,
    lng: viewerSpot?.lng ?? null,
  };
  return { viewer, people, unplaced, filterOptions: buildFilterOptions(people), roles };
}

export async function loadCommunityEvents(
  viewer: CommunityViewerData,
  isAdmin: boolean,
  now: Date = new Date(),
): Promise<CommunityEvent[]> {
  const [rows, meetings] = await Promise.all([
    prisma.communityEvent.findMany({
      where: {
        cancelledAt: null,
        endsAt: { gte: now },
        ...(viewer.isAlumni ? {} : { audience: "alumni_and_students" }),
      },
      orderBy: { startsAt: "asc" },
      take: MAX_EVENTS,
      select: {
        id: true,
        hostId: true,
        title: true,
        description: true,
        startsAt: true,
        endsAt: true,
        online: true,
        meetingUrl: true,
        placeName: true,
        address: true,
        lat: true,
        lng: true,
        audience: true,
        notifyNearby: true,
        host: {
          select: {
            firstName: true,
            lastName: true,
            photoUrl: true,
            workExperiences: {
              where: { endDate: null },
              orderBy: { startDate: "desc" },
              take: 1,
              select: { position: true, company: true },
            },
          },
        },
        rsvps: {
          orderBy: { createdAt: "asc" },
          select: {
            userId: true,
            user: {
              select: {
                firstName: true,
                lastName: true,
                photoUrl: true,
                classYear: true,
                membershipStatus: true,
                projectAssignments: {
                  select: {
                    project: { select: { id: true, name: true } },
                    term: { select: { code: true } },
                  },
                },
              },
            },
          },
        },
      },
    }),
    listUpcomingMeetings(viewer.id, now, new Date(now.getTime() + EVENT_WINDOW_DAYS * 86_400_000)),
  ]);

  const alumniEvents = await Promise.all(
    rows.map(async (r): Promise<CommunityEvent> => {
      const going = r.rsvps.map((rsvp) => {
        const u = rsvp.user;
        const projects = u.projectAssignments.map((a) => ({
          id: a.project.id,
          name: a.project.name,
          term: a.term.code,
        }));
        const reason = whyLine(
          { projects, isStudent: u.membershipStatus !== "Alumni", classYear: u.classYear },
          viewer,
        );
        return { id: rsvp.userId, user: u, reason };
      });
      const others = going.filter((g) => g.id !== viewer.id);
      const shown = [...others.filter((g) => g.reason), ...others.filter((g) => !g.reason)].slice(
        0,
        ATTENDEES_SHOWN,
      );
      return {
        id: r.id,
        source: "alumni",
        title: r.title,
        description: r.description,
        startsAt: r.startsAt.toISOString(),
        endsAt: r.endsAt.toISOString(),
        online: r.online,
        meetingUrl: r.meetingUrl,
        placeName: r.placeName,
        address: r.address,
        location: r.online ? "Online" : (r.placeName ?? HANOVER.label),
        lat: r.lat,
        lng: r.lng,
        audience: r.audience as EventAudience,
        notifyNearby: r.notifyNearby,
        host: {
          id: r.hostId,
          name: fullName(r.host) || "Alum",
          photoUrl: await resolvePhotoUrl(r.host.photoUrl),
          currentJob: jobLabel(r.host.workExperiences[0]),
        },
        hostName: fullName(r.host) || null,
        goingCount: going.length,
        knownGoingCount: others.filter((g) => g.reason).length,
        viewerGoing: going.some((g) => g.id === viewer.id),
        attendees: await Promise.all(
          shown.map(async (g) => ({
            id: g.id,
            name: fullName(g.user) || "Member",
            photoUrl: await resolvePhotoUrl(g.user.photoUrl),
            reason: g.reason,
          })),
        ),
        canManage: isAdmin || r.hostId === viewer.id,
        href: null,
      };
    }),
  );

  const daliEvents: CommunityEvent[] = meetings
    .filter((m) => m.source === "dali")
    .map((m) => {
      const online = !m.location && Boolean(m.meetingUrl);
      return {
        id: `dali:${m.id}:${m.occurrenceStart}`,
        source: "dali",
        title: m.title,
        description: m.description,
        startsAt: m.startsAt,
        endsAt: m.endsAt,
        online,
        meetingUrl: m.meetingUrl,
        placeName: online ? null : m.location,
        address: null,
        location: online ? "Online" : (m.location ?? HANOVER.label),
        lat: online ? null : HANOVER.lat,
        lng: online ? null : HANOVER.lng,
        audience: null,
        notifyNearby: false,
        host: null,
        hostName: null,
        goingCount: m.attendeeCount,
        knownGoingCount: 0,
        viewerGoing: false,
        attendees: [],
        canManage: false,
        href: meetingOccurrenceHref(m.id, m.occurrenceStart),
      };
    });

  return [...alumniEvents, ...daliEvents].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

export async function loadCommunity(viewerId: string, now: Date = new Date()): Promise<CommunityData> {
  const { viewer, people, unplaced, filterOptions, roles } = await loadCommunityPeople(viewerId, now);
  const events = await loadCommunityEvents(viewer, roles.isAdmin, now);
  return { viewer, people, unplaced, filterOptions, events };
}
