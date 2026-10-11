// MCP blog tools (Resources → blog). Same gates as the web: the `resources`
// flag + lab membership, a draft is its author's and Core's alone, and only an
// Admin publishes.
//   list_blog_posts   — mcp:read
//   read_blog_post    — mcp:read
//   manage_blog_post  — mcp:write  (faceted: create/update/publish/unpublish)

import { prisma } from "~/lib/db";
import { fullName } from "~/lib/display";
import { isAdmin } from "~/lib/roles";
import { resourcesAccess } from "~/lib/resources.server";
import { blogListing } from "~/lib/blog-preview";
import {
  BLOG_LISTING_ORDER,
  blogStatus,
  canChangeBlogAudience,
  findBlogPost,
  listedBlogPostsWhere,
  publishBlogPost,
  unpublishBlogPost,
} from "~/lib/blog-post.server";
import { blocksToMarkdown, markdownToBlocks } from "~/collab/blocknote-server";
import { ensureBlocks } from "~/collab/legacy/pm-to-blocknote";
import { blogPostRoomName } from "~/collab/roomName";
import { replaceCollabDocContent } from "~/collab/write";
import {
  McpForbiddenError,
  McpInvalidError,
  McpNotFoundError,
  requireForAction,
} from "~/mcp/errors";
import { MAX_MARKDOWN_LENGTH } from "../set-page-content";

async function requireViewer(callerId: string) {
  const access = await resourcesAccess(callerId);
  if (!access) throw new McpForbiddenError("Resources is not available to you");
  return { id: callerId, core: access.core };
}

type PostRow = {
  id: string;
  title: string;
  summary: string | null;
  excerpt: string;
  customCoverUrl: string | null;
  coverImageUrl: string | null;
  visibility: "Internal" | "Public";
  publishedAt: Date | null;
  submittedAt: Date | null;
  authorId: string;
  author: { firstName: string | null; lastName: string | null };
};

function describePost(p: PostRow, callerId: string) {
  return {
    id: p.id,
    title: p.title,
    excerpt: blogListing(p).excerpt,
    visibility: p.visibility,
    status: blogStatus(p),
    author: fullName(p.author),
    mine: p.authorId === callerId,
    publishedAt: p.publishedAt?.toISOString() ?? null,
  };
}

// ─── list_blog_posts ─────────────────────────────────────────────────────────

export const LIST_BLOG_POSTS_TOOL = {
  name: "list_blog_posts",
  description:
    "List blog posts on the Resources front page: every published post, the caller's own drafts, and (for an Admin) posts waiting for approval. Returns metadata and an excerpt; use read_blog_post for the body. status is 'draft', 'review' (submitted, waiting on an Admin) or 'published'. visibility 'Public' posts also appear on the DALI website once published.",
  inputSchema: {
    type: "object" as const,
    properties: {
      status: {
        type: "string",
        enum: ["draft", "review", "published"],
        description: "Only posts in this state. Omit for all of them.",
      },
    },
    additionalProperties: false,
  },
  requiredScope: "mcp:read" as const,
};

type ListInput = { status?: "draft" | "review" | "published" };

export async function runListBlogPosts(callerId: string, input: ListInput) {
  await requireViewer(callerId);
  const rows = await prisma.blogPost.findMany({
    where: listedBlogPostsWhere(callerId, await isAdmin(callerId)),
    orderBy: BLOG_LISTING_ORDER,
    select: {
      id: true,
      title: true,
      summary: true,
      excerpt: true,
      customCoverUrl: true,
      coverImageUrl: true,
      visibility: true,
      publishedAt: true,
      submittedAt: true,
      authorId: true,
      author: { select: { firstName: true, lastName: true } },
    },
  });
  const posts = rows.map((r) => describePost(r, callerId));
  return { posts: input.status ? posts.filter((p) => p.status === input.status) : posts };
}

// ─── read_blog_post ──────────────────────────────────────────────────────────

export const READ_BLOG_POST_TOOL = {
  name: "read_blog_post",
  description:
    "Read one blog post: its metadata and its body as Markdown. A draft is readable only by its author and Core. Lossy for editor-only blocks, like read_page. Round-trips with manage_blog_post's markdown.",
  inputSchema: {
    type: "object" as const,
    properties: {
      postId: { type: "string", minLength: 1 },
    },
    required: ["postId"],
    additionalProperties: false,
  },
  requiredScope: "mcp:read" as const,
};

type ReadInput = { postId: string };

export async function runReadBlogPost(callerId: string, input: ReadInput) {
  const found = await findBlogPost(await requireViewer(callerId), input.postId);
  if (!found) throw new McpNotFoundError("Post not found");
  const { post, canEdit } = found;
  return {
    ...describePost(post, callerId),
    summary: post.summary,
    canEdit,
    markdown: await blocksToMarkdown(ensureBlocks(post.contentJson)),
  };
}

// ─── manage_blog_post ────────────────────────────────────────────────────────

export const MANAGE_BLOG_POST_TOOL = {
  name: "manage_blog_post",
  description:
    "Write a blog post. Actions: create (a new draft by the caller), update (title/summary/audience/body), publish, unpublish. Only the author and Core can change a post. publish by an Admin publishes it (and approves a post in review); by anyone else it submits the draft to the Admins for review. unpublish returns a published post to a draft, or withdraws one from review. markdown OVERWRITES the whole body (same Markdown as set_page_content); read_blog_post first to preserve content. isPublic also lists the post on the DALI website once published, and only an Admin can change it after a post leaves draft.",
  inputSchema: {
    type: "object" as const,
    properties: {
      action: { type: "string", enum: ["create", "update", "publish", "unpublish"] },
      postId: { type: "string", description: "Required for all actions except 'create'." },
      title: { type: "string", maxLength: 300, description: "For create (required) and update." },
      summary: {
        type: "string",
        maxLength: 500,
        description:
          "For create/update. Shown in listings in place of the excerpt derived from the body. Empty string clears it.",
      },
      isPublic: { type: "boolean", description: "For create/update. Defaults to false (lab only)." },
      markdown: {
        type: "string",
        maxLength: MAX_MARKDOWN_LENGTH,
        description: "For create/update. The post body as Markdown.",
      },
    },
    required: ["action"],
    additionalProperties: false,
  },
  requiredScope: "mcp:write" as const,
};

type ManageInput = {
  action: "create" | "update" | "publish" | "unpublish";
  postId?: string;
  title?: string;
  summary?: string;
  isPublic?: boolean;
  markdown?: string;
};

const ACTION_REQUIRED: Record<string, string[]> = {
  create: ["title"],
  update: ["postId"],
  publish: ["postId"],
  unpublish: ["postId"],
};

function cleanTitle(title: string): string {
  const clean = title.replace(/\s+/g, " ").trim();
  if (!clean) throw new McpInvalidError("Title is required");
  return clean;
}

async function parseBody(markdown: string) {
  try {
    return await markdownToBlocks(markdown);
  } catch {
    throw new McpInvalidError("Markdown could not be parsed");
  }
}

export async function runManageBlogPost(callerId: string, input: ManageInput) {
  requireForAction(input.action, input as Record<string, unknown>, ACTION_REQUIRED);
  const viewer = await requireViewer(callerId);

  // Parsed before anything is written, so bad Markdown changes nothing.
  const blocks = input.markdown === undefined ? null : await parseBody(input.markdown);
  const details = {
    ...(input.title !== undefined && { title: cleanTitle(input.title) }),
    ...(input.summary !== undefined && { summary: input.summary.trim() || null }),
    ...(input.isPublic !== undefined && {
      visibility: input.isPublic ? ("Public" as const) : ("Internal" as const),
    }),
  };

  if (input.action === "create") {
    const created = await prisma.blogPost.create({
      data: { ...details, title: details.title!, authorId: callerId },
      select: { id: true },
    });
    if (blocks) await replaceCollabDocContent(blogPostRoomName(created.id), blocks, callerId);
    return { id: created.id, status: "draft" as const };
  }

  const found = await findBlogPost(viewer, input.postId!);
  if (!found) throw new McpNotFoundError("Post not found");
  const { post, canEdit, canApprove } = found;
  if (!canEdit) throw new McpForbiddenError();

  switch (input.action) {
    case "update": {
      if (details.visibility && details.visibility !== post.visibility && !canChangeBlogAudience(post, canApprove)) {
        throw new McpInvalidError("Move it back to a draft first (unpublish) to change who can see it.");
      }
      if (Object.keys(details).length > 0) {
        await prisma.blogPost.update({ where: { id: post.id }, data: details });
      }
      if (blocks) await replaceCollabDocContent(blogPostRoomName(post.id), blocks, callerId);
      return { id: post.id, status: blogStatus(post) };
    }
    case "publish":
      return { id: post.id, status: await publishBlogPost(post, { id: callerId, canApprove }) };
    case "unpublish":
      await unpublishBlogPost(post.id);
      return { id: post.id, status: "draft" as const };
  }
}
