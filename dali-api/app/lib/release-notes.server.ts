import { redirect } from "react-router";
import type { Prisma } from "~/generated/prisma/client";
import { prisma } from "~/lib/db";
import { requireAuth, redirectPartnerToPortal, isNonMember } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { getUserRoles } from "~/lib/roles";
import { isFeatureEnabled } from "~/lib/feature-flags.server";
import { listVisibleGroupIdsForUser } from "~/lib/groups";
import { getDownloadUrl, isS3Configured } from "~/lib/s3";
import { logAuditEvent } from "~/lib/audit";
import {
  canViewReleaseNote,
  hasUnseenReleaseNotes,
  isReleaseNoteVideoKey,
  type ReleaseNoteViewer,
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

export async function listVisibleReleaseNotes(
  viewer: ReleaseNoteViewerContext,
  opts: { area?: string | null } = {},
) {
  const rows = await prisma.releaseNote.findMany({
    where: { ...PUBLISHED, ...(opts.area ? { area: opts.area } : {}) },
    orderBy: { publishedAt: "desc" },
  });
  return rows.filter((n) => canViewReleaseNote(n, viewer));
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
}

export async function listReleaseNotesForCore() {
  const [drafts, published] = await Promise.all([
    prisma.releaseNote.findMany({
      where: { status: "Draft" },
      orderBy: { draftedAt: "desc" },
    }),
    prisma.releaseNote.findMany({
      where: PUBLISHED,
      orderBy: { publishedAt: "desc" },
      take: 100,
    }),
  ]);
  return { drafts, published };
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

export async function publishReleaseNotes(
  ids: string[],
  userId: string,
  request: Request,
): Promise<{ published: number; skipped: number }> {
  const drafts = await prisma.releaseNote.findMany({
    where: { id: { in: ids }, status: "Draft" },
    select: { id: true, summary: true },
  });
  const ready = drafts.filter((d) => d.summary.trim() !== "").map((d) => d.id);
  if (ready.length > 0) {
    await prisma.releaseNote.updateMany({
      where: { id: { in: ready }, status: "Draft" },
      data: { status: "Published", publishedAt: new Date(), publishedById: userId },
    });
    for (const id of ready) {
      await logAuditEvent({ action: "release_note.publish", userId, targetId: id, request });
    }
  }
  return { published: ready.length, skipped: drafts.length - ready.length };
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
