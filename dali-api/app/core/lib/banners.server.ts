import { prisma } from "~/lib/db";
import { fullName } from "~/lib/display";
import { isUserInAnyGroup } from "~/lib/groups";
import type { UserRoles } from "~/lib/roles";
import { labToday } from "~/core/lib/listserv";
import {
  shouldShow,
  type BannerFrequency,
  type BannerInput,
  type BannerKind,
  type BannerRole,
  type BannerTone,
  type BannerTrigger,
} from "~/core/lib/banners";

export type BannerDTO = {
  id: string;
  name: string;
  kind: BannerKind;
  mediaUrl: string | null;
  videoUrl: string | null;
  headline: string;
  body: string;
  ctaLabel: string;
  ctaUrl: string;
  tone: BannerTone;
  everyone: boolean;
  roles: BannerRole[];
  groupIds: string[];
  trigger: BannerTrigger;
  triggerPath: string | null;
  frequency: BannerFrequency;
  allowSnooze: boolean;
  startsAt: string;
  endsAt: string;
  published: boolean;
  author: string;
};

export type BannerStats = { views: number; clicks: number; snoozes: number };

type BannerRow = Awaited<ReturnType<typeof prisma.banner.findFirstOrThrow>>;

function toDTO(b: BannerRow, author: string): BannerDTO {
  return {
    id: b.id,
    name: b.name,
    kind: b.kind,
    mediaUrl: b.mediaUrl,
    videoUrl: b.videoUrl,
    headline: b.headline,
    body: b.body,
    ctaLabel: b.ctaLabel,
    ctaUrl: b.ctaUrl,
    tone: b.tone,
    everyone: b.everyone,
    roles: b.roles as BannerRole[],
    groupIds: b.groupIds,
    trigger: b.trigger,
    triggerPath: b.triggerPath,
    frequency: b.frequency,
    allowSnooze: b.allowSnooze,
    startsAt: b.startsAt.toISOString(),
    endsAt: b.endsAt.toISOString(),
    published: b.published,
    author,
  };
}

async function authorNames(ids: string[]): Promise<Map<string, string>> {
  const users = await prisma.user.findMany({
    where: { id: { in: [...new Set(ids)] } },
    select: { id: true, firstName: true, lastName: true },
  });
  return new Map(users.map((u) => [u.id, fullName(u) || "Core"]));
}

export async function listBanners(): Promise<(BannerDTO & { stats: BannerStats })[]> {
  const [rows, totals] = await Promise.all([
    prisma.banner.findMany({ orderBy: [{ startsAt: "desc" }] }),
    prisma.bannerImpression.groupBy({
      by: ["bannerId"],
      _sum: { views: true, clicks: true, snoozes: true },
    }),
  ]);
  const names = await authorNames(rows.map((r) => r.createdById));
  const statsById = new Map(
    totals.map((t) => [
      t.bannerId,
      { views: t._sum.views ?? 0, clicks: t._sum.clicks ?? 0, snoozes: t._sum.snoozes ?? 0 },
    ]),
  );
  return rows.map((r) => ({
    ...toDTO(r, names.get(r.createdById) ?? "Core"),
    stats: statsById.get(r.id) ?? { views: 0, clicks: 0, snoozes: 0 },
  }));
}

export async function getBanner(id: string): Promise<BannerDTO | null> {
  const row = await prisma.banner.findUnique({ where: { id } });
  if (!row) return null;
  const names = await authorNames([row.createdById]);
  return toDTO(row, names.get(row.createdById) ?? "Core");
}

function inputData(input: BannerInput) {
  return {
    ...input,
    name: input.name || input.headline || "Untitled banner",
    triggerPath: input.trigger === "Page" ? input.triggerPath : null,
    // Snoozing only exists for banners that would otherwise repeat.
    allowSnooze: input.frequency === "EveryOpen" ? input.allowSnooze : false,
    roles: input.everyone ? [] : input.roles,
    groupIds: input.everyone ? [] : input.groupIds,
    startsAt: new Date(input.startsAt),
    endsAt: new Date(input.endsAt),
  };
}

export async function createBanner(input: BannerInput, actorId: string): Promise<string> {
  const row = await prisma.banner.create({
    data: { ...inputData(input), createdById: actorId },
    select: { id: true },
  });
  return row.id;
}

export async function updateBanner(id: string, input: BannerInput): Promise<boolean> {
  const { count } = await prisma.banner.updateMany({ where: { id }, data: inputData(input) });
  return count === 1;
}

export async function deleteBanner(id: string): Promise<void> {
  await prisma.banner.deleteMany({ where: { id } });
}

export async function audienceIncludes(
  b: { everyone: boolean; roles: string[]; groupIds: string[] },
  userId: string,
  roles: UserRoles,
): Promise<boolean> {
  if (b.everyone) return true;
  if (b.roles.some((r) => r in roles && roles[r as keyof UserRoles])) return true;
  return isUserInAnyGroup(userId, b.groupIds);
}

/**
 * The live banners this viewer should still see, newest first, with the
 * frequency and snooze rules already applied. The client picks which to open
 * based on whether DALI OS just opened or which page it is on.
 */
export async function activeBannersFor(
  userId: string,
  roles: UserRoles,
  now: Date = new Date(),
): Promise<BannerDTO[]> {
  const live = await prisma.banner.findMany({
    where: { published: true, startsAt: { lte: now }, endsAt: { gt: now } },
    orderBy: { startsAt: "desc" },
    include: { impressions: { where: { userId } } },
  });
  if (live.length === 0) return [];
  const today = labToday(now);
  const names = await authorNames(live.map((b) => b.createdById));
  const out: BannerDTO[] = [];
  for (const b of live) {
    const seen = b.impressions[0];
    const ok = shouldShow(
      b,
      seen
        ? {
            views: seen.views,
            lastSeenDay: seen.lastSeenAt ? labToday(seen.lastSeenAt) : null,
            snoozedDay: seen.snoozedDay,
          }
        : null,
      today,
    );
    if (ok && (await audienceIncludes(b, userId, roles))) {
      out.push(toDTO(b, names.get(b.createdById) ?? "Core"));
    }
  }
  return out;
}

export type BannerEvent = "view" | "click" | "snooze";

export async function recordBannerEvent(
  bannerId: string,
  userId: string,
  event: BannerEvent,
  now: Date = new Date(),
): Promise<void> {
  const bump =
    event === "view"
      ? { views: { increment: 1 }, lastSeenAt: now }
      : event === "click"
        ? { clicks: { increment: 1 } }
        : { snoozes: { increment: 1 }, snoozedDay: labToday(now) };
  await prisma.bannerImpression.upsert({
    where: { bannerId_userId: { bannerId, userId } },
    update: bump,
    create: {
      bannerId,
      userId,
      views: event === "view" ? 1 : 0,
      clicks: event === "click" ? 1 : 0,
      snoozes: event === "snooze" ? 1 : 0,
      lastSeenAt: event === "view" ? now : null,
      snoozedDay: event === "snooze" ? labToday(now) : null,
    },
  });
}
