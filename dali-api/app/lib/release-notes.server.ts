import { redirect } from "react-router";
import type { Prisma } from "~/generated/prisma/client";
import { prisma } from "~/lib/db.server";
import { requireAuth, redirectPartnerToPortal, isNonMember } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { getUserRoles } from "~/lib/roles";
import { isFeatureEnabled } from "~/lib/feature-flags.server";
import { listVisibleGroupIdsForUser } from "~/lib/groups";
import { copyObject, getDownloadUrl, isS3Configured } from "~/lib/s3";
import { logAuditEvent } from "~/lib/audit";
import { invalidateLayoutCache } from "~/lib/layout-cache.server";
import { enqueueOutbound, drainNow } from "~/lib/outbound.server";
import { notify } from "~/lib/notify.server";
import { getFrontendUrl } from "~/lib/app-env";
import { resolveAllLabMembers, resolveGroupMembers } from "~/lib/groups";
import {
  groupRecapsByWeek,
  releaseNotePost,
  type RecapNote,
  type RecapWeek,
} from "~/lib/release-notes-recap";
import { decodeCursor, keysetAfter, keysetPage, offsetPage, offsetWindow } from "~/lib/pagination";
import {
  canViewReleaseNote,
  hasUnseenReleaseNotes,
  isReleaseNoteVideoKey,
  publishedVideoKey,
  slackStatus,
  type ReleaseNoteViewer,
  type SlackStatus,
} from "~/lib/release-notes";

export type ReleaseNoteViewerContext = ReleaseNoteViewer & { userId: string };

export async function requireReleaseNoteViewer(
  request: Request,
): Promise<ReleaseNoteViewerContext> {
  const auth = await requireAuth(request);
  if (!auth.ok) throw redirectToLogin(request);
  if (await isNonMember(auth, request)) throw redirect("/portal");
  const partnerRedirect = await redirectPartnerToPortal(auth);
  if (partnerRedirect) throw partnerRedirect;

  const roles = await getUserRoles(auth.user.sub, request);
  const allowed =
    (roles.isLabMember || roles.isCore) &&
    (await isFeatureEnabled("release-notes", auth.user.sub, roles, request));
  if (!allowed) throw new Response("Not found", { status: 404 });

  const groups = await listVisibleGroupIdsForUser(auth.user.sub, request);
  return {
    userId: auth.user.sub,
    isCore: roles.isCore,
    groupIds: groups.map((g) => g.id),
  };
}

export async function requireReleaseNoteEditor(request: Request) {
  const viewer = await requireReleaseNoteViewer(request);
  if (!viewer.isCore) throw redirect("/");
  return viewer;
}

const PUBLISHED = { status: "Published" } as const;

export const RELEASE_NOTES_PAGE_SIZE = 30;
export const RECAP_WEEKS_PAGE_SIZE = 8;
const CORE_PUBLISHED_PAGE_SIZE = 30;

// The SQL form of canViewReleaseNote, so a page is never shorter than asked.
export function audienceWhere(viewer: ReleaseNoteViewer): Prisma.ReleaseNoteWhereInput {
  if (viewer.isCore) return {};
  return { OR: [{ allMembers: true }, { groupIds: { hasSome: [...viewer.groupIds] } }] };
}

export async function loadReleaseNotesPage(
  viewer: ReleaseNoteViewerContext,
  opts: { area?: string | null; cursor?: string | null } = {},
) {
  const rows = await prisma.releaseNote.findMany({
    where: {
      AND: [
        { ...PUBLISHED, publishedAt: { not: null }, ...(opts.area ? { area: opts.area } : {}) },
        audienceWhere(viewer),
        keysetAfter("publishedAt", decodeCursor(opts.cursor)),
      ],
    },
    orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
    take: RELEASE_NOTES_PAGE_SIZE + 1,
  });
  const { items, nextCursor } = keysetPage(rows, RELEASE_NOTES_PAGE_SIZE, (n) => ({
    at: n.publishedAt!.toISOString(),
    id: n.id,
  }));
  return {
    nextCursor,
    items: await Promise.all(
      items.map(async (n) => ({
        id: n.id,
        title: n.title,
        summary: n.summary,
        area: n.area,
        highlight: n.highlight,
        publishedAt: n.publishedAt!.toISOString(),
        hasBody: Array.isArray(n.contentJson) && n.contentJson.length > 0,
        videoUrl: await releaseNoteVideoUrl(n.videoKey).catch(() => null),
      })),
    ),
  };
}

const WEEK_KEY = /^\d{4}-W\d{2}$/;

// Pages by whole weeks: a week's notes are never split across pages.
export async function loadRecapWeeksPage(
  viewer: ReleaseNoteViewerContext,
  cursor: string | null = null,
): Promise<{ items: RecapWeek[]; nextCursor: string | null }> {
  const after = cursor && WEEK_KEY.test(cursor) ? cursor : null;
  const visible = {
    ...PUBLISHED,
    recapWeek: after ? { not: null, lt: after } : { not: null },
    ...audienceWhere(viewer),
  } satisfies Prisma.ReleaseNoteWhereInput;
  const weekRows = await prisma.releaseNote.groupBy({
    by: ["recapWeek"],
    where: visible,
    orderBy: { recapWeek: "desc" },
    take: RECAP_WEEKS_PAGE_SIZE + 1,
  });
  const weeks = weekRows.flatMap((r) => (r.recapWeek ? [r.recapWeek] : []));
  const pageWeeks = weeks.slice(0, RECAP_WEEKS_PAGE_SIZE);
  if (pageWeeks.length === 0) return { items: [], nextCursor: null };
  const notes = await prisma.releaseNote.findMany({
    where: { ...PUBLISHED, recapWeek: { in: pageWeeks }, ...audienceWhere(viewer) },
    orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
    select: {
      id: true,
      title: true,
      summary: true,
      area: true,
      highlight: true,
      allMembers: true,
      groupIds: true,
      recapWeek: true,
    },
  });
  return {
    items: groupRecapsByWeek(notes, viewer),
    nextCursor: weeks.length > RECAP_WEEKS_PAGE_SIZE ? pageWeeks[pageWeeks.length - 1] : null,
  };
}

export async function getVisibleReleaseNote(
  viewer: ReleaseNoteViewerContext,
  id: string,
) {
  const note = await prisma.releaseNote.findFirst({ where: { id, ...PUBLISHED } });
  return note && canViewReleaseNote(note, viewer) ? note : null;
}

export async function releaseNoteVideoUrl(videoKey: string | null): Promise<string | null> {
  if (!videoKey || !isS3Configured()) return null;
  return getDownloadUrl(videoKey);
}

export async function viewerHasUnseenReleaseNotes(
  viewer: ReleaseNoteViewerContext,
): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: viewer.userId },
    select: { releaseNotesSeenAt: true },
  });
  const seenAt = user?.releaseNotesSeenAt ?? null;
  const rows = await prisma.releaseNote.findMany({
    where: { ...PUBLISHED, ...(seenAt ? { publishedAt: { gt: seenAt } } : {}) },
    select: { allMembers: true, groupIds: true, publishedAt: true },
  });
  return hasUnseenReleaseNotes(rows, viewer, seenAt);
}

export async function markReleaseNotesSeen(userId: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { releaseNotesSeenAt: new Date() },
  });
  invalidateLayoutCache("releaseNotes", [userId]);
}

export async function listReleaseNotesForCore(page = 1) {
  const [drafts, publishedRows, publishedTotal] = await Promise.all([
    prisma.releaseNote.findMany({
      where: { status: "Draft" },
      orderBy: { draftedAt: "desc" },
    }),
    prisma.releaseNote.findMany({
      where: PUBLISHED,
      orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
      ...offsetWindow(page, CORE_PUBLISHED_PAGE_SIZE),
    }),
    prisma.releaseNote.count({ where: PUBLISHED }),
  ]);
  const { items: published, hasNext } = offsetPage(publishedRows, CORE_PUBLISHED_PAGE_SIZE);
  return { drafts, published, hasNext, publishedTotal };
}

export async function createReleaseNoteDraft() {
  return prisma.releaseNote.create({
    data: { title: "Untitled", summary: "" },
  });
}

export type ReleaseNoteEdit = {
  title: string;
  summary: string;
  area: string | null;
  prNumbers: number[];
  highlight: boolean;
  allMembers: boolean;
  groupIds: string[];
  contentJson?: Prisma.InputJsonValue;
  videoKey: string | null;
};

export async function updateReleaseNote(id: string, edit: ReleaseNoteEdit) {
  const { contentJson, videoKey, ...rest } = edit;
  if (videoKey && !isReleaseNoteVideoKey(videoKey)) {
    throw new Error("Unexpected video location");
  }
  const existing = await prisma.releaseNote.findUnique({
    where: { id },
    select: { videoKey: true },
  });
  const videoChanged = existing?.videoKey !== videoKey;
  return prisma.releaseNote.update({
    where: { id },
    data: {
      ...rest,
      ...(contentJson !== undefined ? { contentJson } : {}),
      ...(videoChanged
        ? { videoKey, videoSource: videoKey ? "upload" : null, posterKey: null }
        : {}),
    },
  });
}

export function releaseNotesSlackChannel(): string | null {
  return process.env.RELEASE_NOTES_SLACK_CHANNEL_ID?.trim() || null;
}

export const releaseNoteSlackKey = (id: string) => `release-note:${id}`;

type PublishedNote = RecapNote & { videoKey: string | null };

async function postReleaseNoteToSlack(note: PublishedNote, userId: string) {
  const channel = releaseNotesSlackChannel();
  if (!channel || !note.allMembers) return;
  const post = releaseNotePost(note, getFrontendUrl());
  const { id } = await enqueueOutbound({
    channel: "slack_channel",
    target: channel,
    dedupKey: releaseNoteSlackKey(note.id),
    slackText: post.text,
    slackBlocks: post.blocks,
    slackFileKey: note.videoKey,
    eventType: "release.published",
    createdByUserId: userId,
  });
  await drainNow([id]);
}

async function notifyHighlight(note: PublishedNote, userId: string) {
  const audience = note.allMembers
    ? await resolveAllLabMembers()
    : (await Promise.all(note.groupIds.map(resolveGroupMembers))).flat();
  const recipients = [...new Set(audience)].map((id) => ({ userId: id }));
  if (recipients.length === 0) return;
  await notify({
    eventType: "release.published",
    createdByUserId: userId,
    message: {
      title: note.title,
      body: note.summary,
      link: `/release-notes/${note.id}`,
      dedupKey: `release-note:${note.id}`,
    },
    recipients,
  });
}

async function moveCaptureToPublished(id: string, videoKey: string | null): Promise<boolean> {
  const dest = publishedVideoKey(id, videoKey);
  if (!dest || !videoKey) return true;
  try {
    await copyObject(videoKey, dest);
  } catch (err) {
    console.error(`[release-notes] video copy failed for ${id}:`, err);
    return false;
  }
  await prisma.releaseNote.update({ where: { id }, data: { videoKey: dest } });
  return true;
}

export async function publishReleaseNotes(
  ids: string[],
  userId: string,
  request: Request,
): Promise<{ published: number; skipped: number }> {
  const drafts = await prisma.releaseNote.findMany({
    where: { id: { in: ids }, status: "Draft" },
    select: { id: true, summary: true, videoKey: true },
  });
  const ready: string[] = [];
  for (const d of drafts) {
    if (d.summary.trim() === "") continue;
    if (await moveCaptureToPublished(d.id, d.videoKey)) ready.push(d.id);
  }
  if (ready.length > 0) {
    const publishedAt = new Date();
    await prisma.releaseNote.updateMany({
      where: { id: { in: ready }, status: "Draft" },
      data: { status: "Published", publishedAt, publishedById: userId },
    });
    const notes = await prisma.releaseNote.findMany({
      where: { id: { in: ready }, status: "Published", publishedById: userId, publishedAt },
    });
    for (const note of notes) {
      await logAuditEvent({ action: "release_note.publish", userId, targetId: note.id, request });
      await postReleaseNoteToSlack(note, userId).catch((err) =>
        console.error("[release-notes] slack enqueue failed:", err),
      );
      if (note.highlight) {
        await notifyHighlight(note, userId).catch((err) =>
          console.error("[release-notes] highlight notify failed:", err),
        );
      }
    }
  }
  return { published: ready.length, skipped: drafts.length - ready.length };
}

export async function releaseNoteSlackStatuses(
  notes: { id: string; allMembers: boolean }[],
): Promise<Record<string, SlackStatus>> {
  const rows = await prisma.outboundMessage.findMany({
    where: { channel: "slack_channel", dedupKey: { in: notes.map((n) => releaseNoteSlackKey(n.id)) } },
    select: { dedupKey: true, status: true },
  });
  const byKey = new Map(rows.map((r) => [r.dedupKey, r.status]));
  return Object.fromEntries(
    notes.map((n) => [n.id, slackStatus(n.allMembers, byKey.get(releaseNoteSlackKey(n.id)))]),
  );
}

export async function dismissReleaseNotes(
  ids: string[],
  userId: string,
  request: Request,
): Promise<number> {
  const drafts = await prisma.releaseNote.findMany({
    where: { id: { in: ids }, status: "Draft" },
    select: { id: true },
  });
  const draftIds = drafts.map((d) => d.id);
  if (draftIds.length === 0) return 0;
  await prisma.releaseNote.updateMany({
    where: { id: { in: draftIds }, status: "Draft" },
    data: { status: "Dismissed" },
  });
  for (const id of draftIds) {
    await logAuditEvent({ action: "release_note.dismiss", userId, targetId: id, request });
  }
  return draftIds.length;
}
