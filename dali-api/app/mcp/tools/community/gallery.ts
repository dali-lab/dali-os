// MCP Community gallery tools: the same feed, post page and writes as
// /community/gallery, through the web's own loaders and applyGalleryIntent.
// Posting is two steps because the bytes go straight to S3: create_gallery_upload
// presigns the original (and the optional display copy and tile, which the
// browser composer makes with a canvas and an agent makes itself), then
// manage_gallery_post create records the post.

import { prisma } from "~/lib/db.server";
import { fullName } from "~/lib/display";
import { getUserRoles, isLabMember } from "~/lib/roles";
import { isFeatureEnabled } from "~/lib/feature-flags.server";
import { getUploadPost, headObject, isS3Configured } from "~/lib/s3";
import { fileMatchesAccept, uploadCapForKey } from "~/lib/file-validation";
import {
  applyGalleryIntent,
  galleryDownloadUrl,
  loadGalleryPage,
  loadGalleryPost,
  visibleTo,
  type GalleryTileData,
  type GalleryViewer,
} from "~/community/lib/gallery.server";
import {
  GALLERY_ACCEPT,
  GALLERY_CAPTION_MAX,
  GALLERY_COMMENT_MAX,
  GALLERY_DISPLAY_MAX,
  GALLERY_EMOJI,
  GALLERY_MAX_PHOTOS,
  GALLERY_THUMB_WIDTH,
  galleryKeyPrefix,
  galleryOriginalKeyPrefix,
} from "~/community/lib/gallery";
import type { McpCtx } from "../../registry";
import {
  McpError,
  McpForbiddenError,
  McpInvalidError,
  McpNotFoundError,
  requireForAction,
} from "../../errors";
import { curlCommand } from "../presigned-upload";

/** Placeholder colour for a post whose caller didn't measure one. */
const DEFAULT_COLOR = "#808080";

export const LIST_GALLERY_POSTS_DEF = {
  name: "list_gallery_posts",
  description:
    "Page through the Community gallery feed, newest first, as the web feed shows it: 40 posts a page with a nextCursor for the next one. Filter to your own posts (show 'mine'), to one person's (byUserId), or by words in the caption or the poster's name (query). imageUrl is the feed-sized copy; use get_gallery_post for the full-size image, the original and comments.",
  inputSchema: {
    type: "object" as const,
    properties: {
      show: { type: "string", enum: ["all", "mine"] },
      byUserId: { type: "string", minLength: 1 },
      query: { type: "string", maxLength: 100 },
      cursor: { type: "string", minLength: 1, description: "nextCursor from the previous page." },
    },
    additionalProperties: false,
  },
  requiredScope: "mcp:read" as const,
};

export const GET_GALLERY_POST_DEF = {
  name: "get_gallery_post",
  description:
    "One Community gallery post: caption, poster, reactions and comments. imageUrl is the copy the post page shows (at most 2048px); originalUrl downloads the untouched original. Links expire within the hour.",
  inputSchema: {
    type: "object" as const,
    properties: { postId: { type: "string", minLength: 1 } },
    required: ["postId"],
    additionalProperties: false,
  },
  requiredScope: "mcp:read" as const,
};

const uploadFileSchema = (description: string) => ({
  type: "object" as const,
  description,
  properties: {
    fileName: { type: "string", minLength: 1, maxLength: 200 },
    contentType: { type: "string", enum: GALLERY_ACCEPT.split(",") },
  },
  required: ["fileName", "contentType"],
  additionalProperties: false,
});

export const CREATE_GALLERY_UPLOAD_DEF = {
  name: "create_gallery_upload",
  description: `Start posting one photo to the Community gallery. Returns a presigned S3 POST and a curl command for each file you name: the original (PNG, JPEG, WebP or GIF, up to 50 MB, kept untouched for download and print) and, as the web composer makes them, an optional display copy at most ${GALLERY_DISPLAY_MAX}px on its long side for the post page and an optional tile ${GALLERY_THUMB_WIDTH}px wide for the feed. Make the copies yourself (e.g. \`sips -Z ${GALLERY_DISPLAY_MAX}\` and \`sips --resampleWidth ${GALLERY_THUMB_WIDTH}\` on macOS) when the original is larger; without them the feed and post page load the original. Run each curl (expect HTTP 204), then call manage_gallery_post action 'create' with the returned keys and the original's pixel width and height. Links expire after 15 minutes.`,
  inputSchema: {
    type: "object" as const,
    properties: {
      original: uploadFileSchema("The photo as taken."),
      display: uploadFileSchema(`A copy at most ${GALLERY_DISPLAY_MAX}px on its long side.`),
      thumb: uploadFileSchema(`A copy ${GALLERY_THUMB_WIDTH}px wide.`),
    },
    required: ["original"],
    additionalProperties: false,
  },
  requiredScope: "mcp:write" as const,
};

const GALLERY_ACTIONS = [
  "create",
  "delete",
  "react",
  "comment",
  "delete_comment",
  "report",
  "hide",
  "restore",
] as const;
type GalleryAction = (typeof GALLERY_ACTIONS)[number];

export const MANAGE_GALLERY_POST_DEF = {
  name: "manage_gallery_post",
  description: `Write to the Community gallery, as the web does. Actions: 'create' (posts: up to ${GALLERY_MAX_PHOTOS}, one per photo, with the keys create_gallery_upload returned); 'delete' (your own post); 'react' (toggle one of ${GALLERY_EMOJI.join(" ")}, notifies the poster); 'comment' (body, @handles mention people); 'delete_comment' (yours, or any as Core); 'report' (someone else's post; two reports hide it); 'hide' and 'restore' (Core only; restoring clears its reports).`,
  inputSchema: {
    type: "object" as const,
    properties: {
      action: { type: "string", enum: [...GALLERY_ACTIONS] },
      postId: { type: "string", minLength: 1 },
      posts: {
        type: "array",
        minItems: 1,
        maxItems: GALLERY_MAX_PHOTOS,
        items: {
          type: "object",
          properties: {
            imageKey: { type: "string", minLength: 1, description: "The original's key." },
            displayKey: { type: "string", minLength: 1 },
            thumbKey: { type: "string", minLength: 1 },
            width: { type: "integer", minimum: 1, description: "The original's width in pixels." },
            height: { type: "integer", minimum: 1, description: "The original's height in pixels." },
            color: {
              type: "string",
              description: "The photo's average colour as #rrggbb, painted while it loads. Defaults to grey.",
            },
            caption: { type: "string", maxLength: GALLERY_CAPTION_MAX },
          },
          required: ["imageKey", "width", "height"],
          additionalProperties: false,
        },
      },
      emoji: { type: "string", enum: [...GALLERY_EMOJI] },
      body: { type: "string", minLength: 1, maxLength: GALLERY_COMMENT_MAX },
      commentId: { type: "string", minLength: 1 },
      reason: { type: "string", maxLength: 500 },
    },
    required: ["action"],
    additionalProperties: false,
  },
  requiredScope: "mcp:write" as const,
};

// The web route's gate: members and alumni, behind the `community` flag.
export async function galleryViewerFor(ctx: McpCtx): Promise<GalleryViewer> {
  const { id } = ctx.user;
  if (!(await isLabMember(id, ctx.request))) throw new McpForbiddenError();
  const roles = await getUserRoles(id, ctx.request);
  if (!(await isFeatureEnabled("community", id, roles, ctx.request))) {
    throw new McpForbiddenError("The gallery is not available");
  }
  return { id, core: roles.isCore, name: fullName(ctx.user) || ctx.user.daliEmail || "" };
}

function author(a: GalleryTileData["author"]) {
  return { id: a.id, name: a.name, classYear: a.classYear };
}

function tile(t: GalleryTileData) {
  return {
    id: t.id,
    caption: t.caption,
    imageUrl: t.imageUrl,
    width: t.width,
    height: t.height,
    author: author(t.author),
    reactions: t.reactions,
    commentCount: t.commentCount,
    hidden: t.hidden,
    mine: t.mine,
    createdAt: t.createdAt,
  };
}

export async function runListGalleryPosts(
  ctx: McpCtx,
  args: { show?: "all" | "mine"; byUserId?: string; query?: string; cursor?: string },
) {
  const viewer = await galleryViewerFor(ctx);
  const page = await loadGalleryPage(viewer, {
    mine: args.show === "mine",
    by: args.byUserId ?? null,
    q: (args.query ?? "").trim(),
    cursor: args.cursor ?? null,
  });
  return { posts: page.posts.map(tile), nextCursor: page.nextCursor };
}

export async function runGetGalleryPost(ctx: McpCtx, args: { postId: string }) {
  const viewer = await galleryViewerFor(ctx);
  const [post, originalUrl] = await Promise.all([
    loadGalleryPost(viewer, args.postId),
    galleryDownloadUrl(viewer, args.postId),
  ]);
  if (!post) throw new McpNotFoundError("Post not found");
  return {
    ...tile(post),
    imageUrl: post.fullImageUrl,
    originalUrl,
    ...(viewer.core ? { reportCount: post.reportCount } : {}),
    reportedByMe: post.reportedByMe,
    comments: post.comments.map((c) => ({
      id: c.id,
      body: c.body,
      createdAt: c.createdAt,
      author: author(c.author),
      canDelete: c.canDelete,
    })),
  };
}

type UploadFile = { fileName: string; contentType: string };

async function presign(prefix: string, file: UploadFile) {
  const contentType = file.contentType.trim().toLowerCase();
  const safeName = file.fileName.trim().replace(/[^A-Za-z0-9._-]/g, "_");
  if (!safeName || !fileMatchesAccept(safeName, contentType, GALLERY_ACCEPT)) {
    throw new McpInvalidError("Only PNG, JPEG, WebP or GIF photos can be posted");
  }
  const key = `uploads/${prefix}/${crypto.randomUUID()}-${safeName}`;
  const cap = uploadCapForKey(key);
  const { url, fields } = await getUploadPost(key, contentType, {
    maxBytes: cap.maxBytes,
    expiresIn: cap.expiresIn,
  });
  return {
    key,
    uploadUrl: url,
    fields,
    maxBytes: cap.maxBytes,
    curl: curlCommand(url, fields, safeName),
  };
}

export async function runCreateGalleryUpload(
  ctx: McpCtx,
  args: { original: UploadFile; display?: UploadFile; thumb?: UploadFile },
) {
  const viewer = await galleryViewerFor(ctx);
  if (!isS3Configured()) {
    throw new McpInvalidError("File storage is not configured in this environment");
  }
  const copies = galleryKeyPrefix(viewer.id);
  const [original, display, thumb] = await Promise.all([
    presign(galleryOriginalKeyPrefix(viewer.id), args.original),
    args.display ? presign(copies, args.display) : null,
    args.thumb ? presign(copies, args.thumb) : null,
  ]);
  return {
    original,
    ...(display ? { display } : {}),
    ...(thumb ? { thumb } : {}),
    next: "Replace /path/to/… with each local file and run its curl (a final line of HTTP 204 means stored). Then call manage_gallery_post with action 'create' and posts: [{ imageKey: original.key, displayKey, thumbKey, width, height, caption }].",
  };
}

type NewPostArg = {
  imageKey: string;
  displayKey?: string;
  thumbKey?: string;
  width: number;
  height: number;
  color?: string;
  caption?: string;
};

type ManageArgs = {
  action: GalleryAction;
  postId?: string;
  posts?: NewPostArg[];
  emoji?: string;
  body?: string;
  commentId?: string;
  reason?: string;
};

const REQUIRED: Record<GalleryAction, string[]> = {
  create: ["posts"],
  delete: ["postId"],
  react: ["postId", "emoji"],
  comment: ["postId", "body"],
  delete_comment: ["commentId"],
  report: ["postId"],
  hide: ["postId"],
  restore: ["postId"],
};

// The web's delete intents succeed quietly when nothing matches; an agent
// needs to hear that the post or comment wasn't there or wasn't theirs.
async function checkTarget(viewer: GalleryViewer, args: ManageArgs) {
  if (args.action === "delete_comment") {
    const comment = await prisma.galleryComment.findFirst({
      where: { id: args.commentId, post: visibleTo(viewer) },
      select: { authorId: true },
    });
    if (!comment) throw new McpNotFoundError("Comment not found");
    if (!viewer.core && comment.authorId !== viewer.id) {
      throw new McpForbiddenError("You can only delete your own comments");
    }
    return;
  }
  if (args.action === "create") return;
  const post = await prisma.galleryPost.findFirst({
    where: { AND: [{ id: args.postId }, visibleTo(viewer)] },
    select: { authorId: true },
  });
  if (!post) throw new McpNotFoundError("Post not found");
  if (args.action === "delete" && post.authorId !== viewer.id) {
    throw new McpForbiddenError("You can only delete your own posts");
  }
}

// The composer only names keys it just uploaded; an agent may name one whose
// curl never ran, and a post without its image would be a blank tile.
async function checkUploaded(posts: NewPostArg[]) {
  if (!isS3Configured()) return;
  for (const p of posts) {
    if (!(await headObject(p.imageKey))) {
      throw new McpNotFoundError(
        `Nothing has been uploaded at ${p.imageKey}. Run its curl from create_gallery_upload first (HTTP 204).`,
      );
    }
  }
}

export async function runManageGalleryPost(ctx: McpCtx, args: ManageArgs) {
  requireForAction(args.action, args as Record<string, unknown>, REQUIRED);
  const viewer = await galleryViewerFor(ctx);
  await checkTarget(viewer, args);

  const fields: Record<string, string> = {
    intent: args.action === "delete_comment" ? "delete-comment" : args.action,
    postId: args.postId ?? "",
    emoji: args.emoji ?? "",
    body: args.body ?? "",
    commentId: args.commentId ?? "",
    reason: args.reason ?? "",
  };
  if (args.posts) {
    await checkUploaded(args.posts);
    fields.posts = JSON.stringify(
      args.posts.map((p) => ({ ...p, color: p.color ?? DEFAULT_COLOR })),
    );
  }

  const result = await applyGalleryIntent(ctx.request, viewer, fields);
  if (!result.ok) {
    throw new McpError(
      result.error ?? (result.status === 403 ? "Forbidden" : "That change could not be made"),
      result.status,
    );
  }
  if (args.action !== "create" || !args.posts) return { ok: true };

  const created = await prisma.galleryPost.findMany({
    where: { authorId: viewer.id, imageKey: { in: args.posts.map((p) => p.imageKey) } },
    select: { id: true, imageKey: true },
  });
  const ids = new Map(created.map((p) => [p.imageKey, p.id]));
  return {
    ok: true,
    posts: args.posts.map((p) => ({
      id: ids.get(p.imageKey) ?? null,
      link: ids.has(p.imageKey) ? `/community/gallery/${ids.get(p.imageKey)}` : null,
    })),
  };
}
