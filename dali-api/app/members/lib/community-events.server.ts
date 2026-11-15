import { z } from "zod";
import { prisma } from "~/lib/db.server";
import { getUserRoles } from "~/lib/roles";
import { geocodePlace } from "~/lib/geocode.server";
import { notify } from "~/lib/notify.server";
import { communityEventNearbyKey } from "~/lib/outbound-keys.server";
import { fullName } from "~/lib/display";
import { APPLICATION_TZ, formatInTimeZone } from "~/lib/timezone";
import { LAB_MEMBER_WHERE } from "~/lib/prisma-shapes";
import { NEARBY_KM, haversineKm } from "~/members/lib/community";

export const EVENT_AUDIENCES = ["alumni", "alumni_and_students"] as const;

export const TITLE_MAX = 120;
export const DESCRIPTION_MAX = 4000;

export type EventResult<T = { id: string }> =
  | ({ ok: true } & T)
  | { ok: false; status: 400 | 403 | 404 | 409; error: string };

const fail = (status: 400 | 403 | 404 | 409, error: string) => ({ ok: false as const, status, error });

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => v || undefined);

const eventSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, "Give the event a name.")
    .max(TITLE_MAX, `Keep the name under ${TITLE_MAX} characters.`),
  description: optionalText(DESCRIPTION_MAX),
  startsAt: z.coerce.date({ error: "Pick a start time." }),
  endsAt: z.coerce.date({ error: "Pick an end time." }),
  mode: z.enum(["inPerson", "online"]),
  placeName: optionalText(120),
  address: optionalText(200),
  meetingUrl: optionalText(500),
  audience: z.enum(EVENT_AUDIENCES),
  notifyNearby: z.boolean().default(false),
});

export type EventInput = z.input<typeof eventSchema>;
type ParsedEvent = z.output<typeof eventSchema>;

function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function parseEvent(
  raw: unknown,
  opts: { now: Date; requireFutureStart: boolean },
): { ok: true; data: ParsedEvent } | { ok: false; error: string } {
  const parsed = eventSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the details and try again." };
  const d = parsed.data;
  if (opts.requireFutureStart && d.startsAt <= opts.now) {
    return { ok: false, error: "Start time has to be in the future." };
  }
  if (d.endsAt <= d.startsAt) return { ok: false, error: "End time has to be after the start." };
  if (d.mode === "inPerson" && !d.placeName) {
    return { ok: false, error: "Add the place name for an in-person event." };
  }
  if (d.mode === "online" && (!d.meetingUrl || !isHttpUrl(d.meetingUrl))) {
    return { ok: false, error: "Add a link that starts with http:// or https://." };
  }
  return { ok: true, data: d };
}

async function resolveWhere(
  d: ParsedEvent,
): Promise<{ ok: true; fields: WhereFields } | { ok: false; error: string }> {
  if (d.mode === "online") {
    return {
      ok: true,
      fields: { online: true, meetingUrl: d.meetingUrl!, placeName: null, address: null, lat: null, lng: null },
    };
  }
  const query = [d.placeName, d.address].filter(Boolean).join(", ");
  const point = await geocodePlace(query);
  if (!point) {
    return { ok: false, error: "We couldn't find that place. Check the name and address." };
  }
  return {
    ok: true,
    fields: {
      online: false,
      meetingUrl: null,
      placeName: d.placeName!,
      address: d.address ?? null,
      lat: point.lat,
      lng: point.lng,
    },
  };
}

type WhereFields = {
  online: boolean;
  meetingUrl: string | null;
  placeName: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
};

export async function createEvent(
  hostId: string,
  raw: unknown,
  request?: Request,
): Promise<EventResult> {
  const roles = await getUserRoles(hostId, request);
  if (!roles.isAlumni) return fail(403, "Only alumni can host events.");

  const parsed = parseEvent(raw, { now: new Date(), requireFutureStart: true });
  if (!parsed.ok) return fail(400, parsed.error);
  const where = await resolveWhere(parsed.data);
  if (!where.ok) return fail(400, where.error);

  const d = parsed.data;
  const event = await prisma.communityEvent.create({
    data: {
      hostId,
      title: d.title,
      description: d.description ?? null,
      startsAt: d.startsAt,
      endsAt: d.endsAt,
      audience: d.audience,
      notifyNearby: d.notifyNearby,
      ...where.fields,
    },
    select: { id: true },
  });

  if (d.notifyNearby && where.fields.lat != null && where.fields.lng != null) {
    await notifyNearbyMembers({
      eventId: event.id,
      hostId,
      title: d.title,
      startsAt: d.startsAt,
      audience: d.audience,
      place: where.fields.placeName,
      lat: where.fields.lat,
      lng: where.fields.lng,
    });
  }
  return { ok: true, id: event.id };
}

async function notifyNearbyMembers(e: {
  eventId: string;
  hostId: string;
  title: string;
  startsAt: Date;
  audience: string;
  place: string | null;
  lat: number;
  lng: number;
}): Promise<void> {
  const latDelta = NEARBY_KM / 111 + 0.01;
  const lngDelta = Math.min(180, latDelta / Math.max(0.01, Math.cos((e.lat * Math.PI) / 180)));
  const [candidates, host] = await Promise.all([
    prisma.user.findMany({
      where: {
        ...LAB_MEMBER_WHERE,
        id: { not: e.hostId },
        ...(e.audience === "alumni" ? { membershipStatus: "Alumni" as const } : {}),
        currentLocationLat: { gte: e.lat - latDelta, lte: e.lat + latDelta },
        currentLocationLng: { gte: e.lng - lngDelta, lte: e.lng + lngDelta },
      },
      select: { id: true, currentLocationLat: true, currentLocationLng: true },
    }),
    prisma.user.findUnique({ where: { id: e.hostId }, select: { firstName: true, lastName: true } }),
  ]);
  const recipients = candidates
    .filter(
      (u) =>
        u.id !== e.hostId &&
        u.currentLocationLat != null &&
        u.currentLocationLng != null &&
        haversineKm({ lat: u.currentLocationLat, lng: u.currentLocationLng }, e) <= NEARBY_KM,
    )
    .map((u) => ({ userId: u.id }));
  if (recipients.length === 0) return;

  const when = formatInTimeZone(e.startsAt, APPLICATION_TZ, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  try {
    await notify({
      eventType: "community.event_nearby",
      createdByUserId: e.hostId,
      message: {
        vars: {
          personName: (host && fullName(host)) || "An alum",
          itemDetail: [e.title, when, e.place].filter(Boolean).join(", "),
        },
        link: `/community?event=${e.eventId}`,
        dedupKey: communityEventNearbyKey(e.eventId),
      },
      recipients,
    });
  } catch (err) {
    console.error("[community-events] nearby notify failed:", err);
  }
}

async function loadEditable(
  userId: string,
  eventId: string,
  request?: Request,
): Promise<
  | { ok: true; event: NonNullable<Awaited<ReturnType<typeof prisma.communityEvent.findUnique>>> }
  | { ok: false; status: 403 | 404; error: string }
> {
  const event = await prisma.communityEvent.findUnique({ where: { id: eventId } });
  if (!event) return { ok: false, status: 404, error: "Event not found." };
  if (event.hostId !== userId) {
    const roles = await getUserRoles(userId, request);
    if (!roles.isAdmin) return { ok: false, status: 403, error: "Only the host can change this event." };
  }
  return { ok: true, event };
}

export async function updateEvent(
  userId: string,
  eventId: string,
  raw: unknown,
  request?: Request,
): Promise<EventResult> {
  const found = await loadEditable(userId, eventId, request);
  if (!found.ok) return fail(found.status, found.error);
  const { event } = found;
  if (event.cancelledAt) return fail(409, "This event was cancelled.");
  const now = new Date();
  if (event.endsAt <= now) return fail(409, "This event has already happened.");

  const startMoved =
    typeof raw === "object" && raw !== null && "startsAt" in raw
      ? new Date(String((raw as { startsAt: unknown }).startsAt)).getTime() !== event.startsAt.getTime()
      : true;
  const parsed = parseEvent(raw, { now, requireFutureStart: startMoved });
  if (!parsed.ok) return fail(400, parsed.error);
  const d = parsed.data;

  const placeUnchanged =
    d.mode === "inPerson" &&
    !event.online &&
    event.lat != null &&
    d.placeName === event.placeName &&
    (d.address ?? null) === event.address;
  const where: { ok: true; fields: WhereFields } | { ok: false; error: string } = placeUnchanged
    ? {
        ok: true,
        fields: {
          online: false,
          meetingUrl: null,
          placeName: event.placeName,
          address: event.address,
          lat: event.lat,
          lng: event.lng,
        },
      }
    : await resolveWhere(d);
  if (!where.ok) return fail(400, where.error);

  await prisma.communityEvent.update({
    where: { id: eventId },
    data: {
      title: d.title,
      description: d.description ?? null,
      startsAt: d.startsAt,
      endsAt: d.endsAt,
      audience: d.audience,
      notifyNearby: d.notifyNearby,
      ...where.fields,
    },
  });
  return { ok: true, id: eventId };
}

export async function cancelEvent(
  userId: string,
  eventId: string,
  request?: Request,
): Promise<EventResult> {
  const found = await loadEditable(userId, eventId, request);
  if (!found.ok) return fail(found.status, found.error);
  if (found.event.cancelledAt) return { ok: true, id: eventId };
  await prisma.communityEvent.update({ where: { id: eventId }, data: { cancelledAt: new Date() } });
  return { ok: true, id: eventId };
}

export async function setRsvp(
  userId: string,
  eventId: string,
  going: boolean,
): Promise<EventResult<{ id: string; going: boolean }>> {
  if (!going) {
    await prisma.communityEventRsvp.deleteMany({ where: { eventId, userId } });
    return { ok: true, id: eventId, going: false };
  }
  const [event, user] = await Promise.all([
    prisma.communityEvent.findUnique({
      where: { id: eventId },
      select: { audience: true, cancelledAt: true, endsAt: true },
    }),
    prisma.user.findUnique({ where: { id: userId }, select: { membershipStatus: true } }),
  ]);
  if (!event) return fail(404, "Event not found.");
  if (event.cancelledAt) return fail(409, "This event was cancelled.");
  if (event.endsAt <= new Date()) return fail(409, "This event has already happened.");
  if (event.audience === "alumni" && user?.membershipStatus !== "Alumni") {
    return fail(403, "This event is for alumni.");
  }
  await prisma.communityEventRsvp.upsert({
    where: { eventId_userId: { eventId, userId } },
    create: { eventId, userId },
    update: {},
  });
  return { ok: true, id: eventId, going: true };
}

export async function getEventForCalendar(
  userId: string,
  eventId: string,
): Promise<
  EventResult<{
    id: string;
    event: {
      id: string;
      title: string;
      description: string | null;
      startsAt: Date;
      endsAt: Date;
      online: boolean;
      meetingUrl: string | null;
      placeName: string | null;
      address: string | null;
    };
  }>
> {
  const [event, user] = await Promise.all([
    prisma.communityEvent.findUnique({
      where: { id: eventId },
      select: {
        id: true,
        title: true,
        description: true,
        startsAt: true,
        endsAt: true,
        online: true,
        meetingUrl: true,
        placeName: true,
        address: true,
        audience: true,
        cancelledAt: true,
      },
    }),
    prisma.user.findUnique({ where: { id: userId }, select: { membershipStatus: true } }),
  ]);
  if (!event || event.cancelledAt) return fail(404, "Event not found.");
  if (event.audience === "alumni" && user?.membershipStatus !== "Alumni") {
    return fail(403, "This event is for alumni.");
  }
  const { audience: _audience, cancelledAt: _cancelledAt, ...rest } = event;
  return { ok: true, id: event.id, event: rest };
}
