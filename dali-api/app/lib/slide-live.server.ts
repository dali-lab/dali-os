import { z } from "zod";
import { prisma } from "~/lib/db.server";
import { publish } from "~/lib/realtime-bus.server";
import { deckAccess } from "~/lib/slide-decks.server";
import { isFeatureEnabled } from "~/lib/feature-flags.server";
import { getUserRoles } from "~/lib/roles";
import { displayName } from "~/lib/mobile-format";
import { INACTIVE_LIVE, type LiveState } from "~/components/slides/live/types";

export const slideLiveTopic = (pageId: string) => `slide-live:${pageId}`;

export const liveIntentSchema = z.discriminatedUnion("intent", [
  z.object({ intent: z.literal("start"), slideId: z.string().min(1).max(100), build: z.number().int().min(0).max(999).optional() }),
  z.object({ intent: z.literal("go"), slideId: z.string().min(1).max(100), build: z.number().int().min(0).max(999).optional() }),
  z.object({ intent: z.literal("end") }),
]);
export type LiveIntent = z.infer<typeof liveIntentSchema>;

export type LiveResult = { ok: true; live: LiveState } | { ok: false; status: number; error: string };

export async function slidesLiveEnabled(userId: string, request?: Request): Promise<boolean> {
  return isFeatureEnabled("slides-live", userId, await getUserRoles(userId, request), request);
}

const fail = (status: number, error: string) => ({ ok: false as const, status, error });

type Row = {
  presenterId: string;
  slideId: string;
  build: number;
  startedAt: Date;
  endedAt: Date | null;
  reactionsOff: boolean;
  presenter: { firstName: string; lastName: string };
};

const ROW_SELECT = {
  presenterId: true,
  slideId: true,
  build: true,
  startedAt: true,
  endedAt: true,
  reactionsOff: true,
  presenter: { select: { firstName: true, lastName: true } },
} as const;

function toLive(row: Row | null): LiveState {
  if (!row || row.endedAt) return INACTIVE_LIVE;
  return {
    active: true,
    slideId: row.slideId,
    build: row.build,
    presenter: { id: row.presenterId, name: displayName(row.presenter.firstName, row.presenter.lastName) },
    startedAt: row.startedAt.toISOString(),
    reactionsOff: row.reactionsOff,
  };
}

const readRow = (pageId: string) =>
  prisma.slidePresentation.findUnique({ where: { pageId }, select: ROW_SELECT }) as Promise<Row | null>;

export async function readLive(userId: string, pageId: string, request?: Request): Promise<LiveResult> {
  const access = await deckAccess(userId, pageId, request);
  if (!access.ok) return access;
  return { ok: true, live: toLive(await readRow(pageId)) };
}

/**
 * Anyone who can edit the deck may start, and starting while someone else is
 * presenting takes over. Only the current presenter may go or end. A write
 * that changes nothing is dropped and publishes nothing.
 */
export async function applyLive(userId: string, pageId: string, input: LiveIntent, request?: Request): Promise<LiveResult> {
  const access = await deckAccess(userId, pageId, request);
  if (!access.ok) return access;
  if (!access.canEdit) return fail(403, "You can view this deck but not present it.");

  const current = await readRow(pageId);
  const live = toLive(current);
  const isPresenter = live.active && live.presenter?.id === userId;

  if (input.intent === "end") {
    if (!live.active) return { ok: true, live };
    if (!isPresenter) return fail(403, "Only the presenter can end this.");
    await prisma.slidePresentation.update({ where: { pageId }, data: { endedAt: new Date() } });
    publish(slideLiveTopic(pageId));
    return { ok: true, live: INACTIVE_LIVE };
  }

  const build = input.build ?? 0;

  if (input.intent === "go") {
    if (!isPresenter) return fail(live.active ? 403 : 409, live.active ? "Only the presenter can move the deck." : "Nobody is presenting.");
    if (live.slideId === input.slideId && live.build === build) return { ok: true, live };
    await prisma.slidePresentation.update({ where: { pageId }, data: { slideId: input.slideId, build } });
    publish(slideLiveTopic(pageId));
    return { ok: true, live: { ...live, slideId: input.slideId, build } };
  }

  if (isPresenter && live.slideId === input.slideId && live.build === build) return { ok: true, live };
  const resumed = isPresenter;
  const startedAt = resumed ? undefined : new Date();
  await prisma.slidePresentation.upsert({
    where: { pageId },
    create: { pageId, presenterId: userId, slideId: input.slideId, build, startedAt },
    update: {
      presenterId: userId,
      slideId: input.slideId,
      build,
      endedAt: null,
      ...(startedAt ? { startedAt, closedPolls: [], reactionsOff: false } : {}),
    },
  });
  if (startedAt) await prisma.slidePollVote.deleteMany({ where: { presentation: { pageId } } });
  publish(slideLiveTopic(pageId));
  return { ok: true, live: toLive(await readRow(pageId)) };
}
