import type { Route } from "./+types/api.page-docs.$key";
import { z } from "zod";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isCore, isLabMember } from "~/lib/roles";
import { parseJson } from "~/lib/validate";
import { getDownloadUrl, isS3Configured } from "~/lib/s3";
import { notify } from "~/lib/notify.server";
import { extractMentionUserIds, notifyMentions, pageDocLink } from "~/lib/mentions";
import { fullName } from "~/lib/display";
import {
  mergeSectionsPayload,
  resolveSections,
  type StoredPageDocSection,
} from "~/lib/page-doc-sections";

// Per-page documentation guide, keyed by a stable pageKey a route declares via
// handle.docKey. Backs the "Docs" modal.
//   GET  /api/page-docs/:key?title=...  → the guide + viewer permissions
//   POST /api/page-docs/:key            → upsert content / maintainer
//
// Any lab member may read (and, via /api/comments, post FAQ comments). Editing
// title/body/video/sections is limited to the maintainer or Core/Admin;
// assigning the maintainer is Core/Admin only.

const UpdateSchema = z.object({
  // Present only for the field being changed — undefined means "leave as is".
  title: z.string().trim().min(1).max(200).optional(),
  // Legacy single-body fields (still accepted). Prefer `sections` for new edits.
  body: z.unknown().optional(),
  videoKey: z.string().max(500).nullable().optional(),
  sections: z.array(z.unknown()).optional(),
  maintainerId: z.string().nullable().optional(),
  // The page's current path, used to deep-link mention/maintainer notifications
  // back to the guide (with ?doc=1 so the modal auto-opens).
  path: z.string().max(1000).optional(),
});

async function resolveVideoUrl(videoKey: string | null): Promise<string | null> {
  if (!videoKey) return null;
  if (!isS3Configured()) return null;
  return getDownloadUrl(videoKey);
}

async function serializeSections(sections: StoredPageDocSection[]) {
  return Promise.all(
    sections.map(async (s) => ({
      id: s.id,
      title: s.title,
      body: s.body,
      videoUrl: await resolveVideoUrl(s.videoKey),
      hasVideo: s.videoKey !== null,
    })),
  );
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  const userId = auth.user.sub;
  if (!(await isLabMember(userId))) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const pageKey = params.key;
  const title = new URL(request.url).searchParams.get("title")?.trim() || pageKey;

  // Create-on-first-view so FAQ comments always have a target id. Existing rows
  // keep their title/content untouched.
  const doc = await prisma.pageDoc.upsert({
    where: { pageKey },
    update: {},
    create: { pageKey, title, createdById: userId },
    select: {
      id: true,
      title: true,
      body: true,
      videoKey: true,
      sections: true,
      maintainerId: true,
      maintainer: { select: { id: true, firstName: true, lastName: true, handle: true } },
    },
  });

  const core = await isCore(userId);
  const canEdit = core || doc.maintainerId === userId;
  const sections = resolveSections(doc);
  const serialized = await serializeSections(sections);
  const primary = serialized[0]!;

  return Response.json({
    doc: {
      id: doc.id,
      title: doc.title,
      // Legacy single-field mirrors of the first section (older clients / FAQ).
      body: primary.body,
      videoUrl: primary.videoUrl,
      hasVideo: primary.hasVideo,
      sections: serialized,
    },
    maintainer: doc.maintainer
      ? {
          id: doc.maintainer.id,
          name: fullName(doc.maintainer),
          handle: doc.maintainer.handle,
        }
      : null,
    canEdit,
    canAssignMaintainer: core,
    currentUserId: userId,
  });
}

export async function action({ request, params }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  const userId = auth.user.sub;
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }
  if (!(await isLabMember(userId))) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const payload = await parseJson(request, UpdateSchema);
  if (payload instanceof Response) return payload;

  const pageKey = params.key;
  const existing = await prisma.pageDoc.findUnique({
    where: { pageKey },
    select: { id: true, body: true, videoKey: true, sections: true, maintainerId: true },
  });
  if (!existing) {
    return Response.json({ error: "Guide not found" }, { status: 404 });
  }

  const core = await isCore(userId);
  const canEditContent = core || existing.maintainerId === userId;

  const changingContent =
    payload.title !== undefined ||
    payload.body !== undefined ||
    payload.videoKey !== undefined ||
    payload.sections !== undefined;
  const changingMaintainer =
    payload.maintainerId !== undefined && payload.maintainerId !== existing.maintainerId;

  if (changingContent && !canEditContent) {
    return Response.json(
      { error: "Only the maintainer or Core can edit this guide." },
      { status: 403 },
    );
  }
  if (changingMaintainer && !core) {
    return Response.json(
      { error: "Only Core can assign the maintainer." },
      { status: 403 },
    );
  }

  // A named maintainer must be a real lab member.
  if (changingMaintainer && payload.maintainerId) {
    if (!(await isLabMember(payload.maintainerId))) {
      return Response.json({ error: "That member can't be a maintainer." }, { status: 400 });
    }
  }

  const priorSections = resolveSections(existing);
  let nextSections: StoredPageDocSection[] | undefined;

  if (payload.sections !== undefined) {
    const merged = mergeSectionsPayload(payload.sections, priorSections);
    if ("error" in merged) {
      return Response.json({ error: merged.error }, { status: 400 });
    }
    nextSections = merged;
  } else if (payload.body !== undefined || payload.videoKey !== undefined) {
    // Legacy single-section edit: patch the first section only.
    const [first, ...rest] = priorSections;
    const head = first ?? {
      id: "overview",
      title: "Overview",
      body: null,
      videoKey: null,
    };
    nextSections = [
      {
        ...head,
        body: payload.body !== undefined ? payload.body : head.body,
        videoKey: payload.videoKey !== undefined ? payload.videoKey : head.videoKey,
      },
      ...rest,
    ];
  }

  const data: {
    title?: string;
    body?: unknown;
    videoKey?: string | null;
    sections?: StoredPageDocSection[];
    maintainerId?: string | null;
    lastEditedById: string;
  } = { lastEditedById: userId };
  if (payload.title !== undefined) data.title = payload.title;
  if (changingMaintainer) data.maintainerId = payload.maintainerId ?? null;
  if (nextSections) {
    data.sections = nextSections;
    // Keep legacy columns aligned with the first section.
    data.body = nextSections[0]?.body ?? null;
    data.videoKey = nextSections[0]?.videoKey ?? null;
  }

  const updated = await prisma.pageDoc.update({
    where: { id: existing.id },
    data: data as never,
    select: { id: true, title: true },
  });

  // Notify newly-mentioned users across all section bodies (diff against prior).
  if (nextSections) {
    const before = new Set(
      priorSections.flatMap((s) => extractMentionUserIds(s.body)),
    );
    const added = nextSections
      .flatMap((s) => extractMentionUserIds(s.body))
      .filter((id) => !before.has(id));
    // Dedupe in case the same handle appears in multiple sections.
    const uniqueAdded = [...new Set(added)];
    if (uniqueAdded.length > 0) {
      void notifyMentions({
        recipientUserIds: uniqueAdded,
        actorId: userId,
        link: pageDocLink(payload.path),
        title: `You were mentioned in: ${updated.title}`,
        preview: "You were tagged in a page guide.",
      }).catch((err) => console.error(`pagedoc ${updated.id}: mention notify failed`, err));
    }
  }

  // Notify a newly-assigned maintainer.
  if (changingMaintainer && payload.maintainerId && payload.maintainerId !== userId) {
    void notify({
      eventType: "pagedoc.maintainer_assigned",
      createdByUserId: userId,
      message: {
        title: `You're now the maintainer of: ${updated.title}`,
        body: "You can edit this page's guide — sections, video, walkthrough, and FAQ.",
        link: pageDocLink(payload.path),
      },
      recipients: [{ userId: payload.maintainerId }],
    }).catch((err) =>
      console.error(`pagedoc ${updated.id}: maintainer notify failed`, err),
    );
  }

  return Response.json({ ok: true });
}
