import { prisma } from "~/lib/db.server";
import { readDocAsBlocks } from "~/collab/read";
import { blocksToMarkdown } from "~/collab/blocknote-server";
import { resourceHubRoomName } from "~/collab/roomName";
import { critCommentCounts, displayName, serializeSubmission } from "~/lib/crit.server";
import { critThreadHref } from "~/lib/crit-comments";
import { loadHubAccess, ledDomainIds, resourceHubViewer, type HubAccess } from "~/lib/resource-hub.server";
import { limitLinkPreviews } from "~/lib/link-preview-limit.server";
import { parseReferenceForm, resolveReference, serializeReference } from "~/lib/references.server";
import type { McpCtx } from "../../registry";
import { McpError, McpForbiddenError, McpInvalidError, McpNotFoundError } from "../../errors";
import { TEXT_PAGE_LIMITS, offsetPage, offsetWindow, pageProps, pageText, type PageArgs } from "../../pagination";

const LIST_LIMITS = { defaultLimit: 25, maxLimit: 100 };
const hubUrl = (id: string) => `/resource-hub/${id}`;

const hubRef = {
  hubId: { type: "string", minLength: 1, description: "A hub id from list_resource_hubs." },
  domainId: { type: "string", minLength: 1, description: "A domain id from list_domains. Used when hubId is not given." },
};

type HubRef = { hubId?: string; domainId?: string };

async function requireHub(ctx: McpCtx, ref: HubRef): Promise<HubAccess> {
  if (!ref.hubId && !ref.domainId) throw new McpInvalidError("Pass hubId or domainId.");
  const access = await loadHubAccess(ctx.user.id, ref, ctx.request);
  if (!access) throw new McpNotFoundError("Resource hub not found");
  return access;
}

async function requireDomainHub(ctx: McpCtx, ref: HubRef) {
  const access = await requireHub(ctx, ref);
  if (!access.hub.domainId) throw new McpInvalidError("This hub has no domain, so it has no Crit Wall or references.");
  return { ...access, domainId: access.hub.domainId };
}

export const LIST_RESOURCE_HUBS_TOOL = {
  name: "list_resource_hubs",
  description:
    "List the Resource Hubs you can open, one per domain: id, domain, title, whether it is published, whether you can edit it, and its URL. Everyone sees published hubs; drafts show only to Core, the hub's creator and the leads of its domain.",
  inputSchema: { type: "object" as const, properties: {}, additionalProperties: false },
  requiredScope: "mcp:read" as const,
};

export async function runListResourceHubs(ctx: McpCtx) {
  const userId = ctx.user.id;
  const viewer = await resourceHubViewer(userId, ctx.request);
  if (!viewer) throw new McpNotFoundError("Resource Hub is not available to you");
  const led = viewer.core ? [] : await ledDomainIds(userId);
  const rows = await prisma.resourceHubPage.findMany({
    where: viewer.core
      ? {}
      : {
          OR: [
            { publishedAt: { not: null } },
            { createdById: userId },
            ...(led.length ? [{ domainId: { in: led } }] : []),
          ],
        },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      title: true,
      publishedAt: true,
      domainId: true,
      createdById: true,
      domain: { select: { displayName: true } },
    },
  });
  return {
    hubs: rows.map((r) => ({
      id: r.id,
      domainId: r.domainId,
      domain: r.domain?.displayName ?? null,
      title: r.title,
      published: r.publishedAt !== null,
      canEdit: viewer.core || r.createdById === userId || (r.domainId !== null && led.includes(r.domainId)),
      url: hubUrl(r.id),
    })),
  };
}

export const GET_RESOURCE_HUB_TOOL = {
  name: "get_resource_hub",
  description:
    "One Resource Hub: title, domain, published state and its page as Markdown, plus how many Crit Wall posts and references its domain has. Pass hubId or domainId. A draft hub is not found unless you can edit it. Long pages come back in chunks of limit characters: pass page.nextCursor as cursor until page.hasMore is false.",
  inputSchema: {
    type: "object" as const,
    properties: { ...hubRef, ...pageProps(TEXT_PAGE_LIMITS) },
    additionalProperties: false,
  },
  requiredScope: "mcp:read" as const,
};

export async function runGetResourceHub(ctx: McpCtx, input: HubRef & PageArgs) {
  const { hub, canEdit } = await requireHub(ctx, input);
  const [blocks, critPosts, references] = await Promise.all([
    readDocAsBlocks(resourceHubRoomName(hub.id)),
    hub.domainId ? prisma.critSubmission.count({ where: { domainId: hub.domainId } }) : 0,
    hub.domainId ? prisma.domainReference.count({ where: { domainId: hub.domainId } }) : 0,
  ]);
  const full = blocks.length ? await blocksToMarkdown(blocks, { inlineRefs: true }) : "";
  const { text: markdown, page } = pageText(full, input);
  return {
    id: hub.id,
    title: hub.title,
    domainId: hub.domainId,
    domain: hub.domain?.displayName ?? null,
    published: hub.publishedAt !== null,
    canEdit,
    url: hubUrl(hub.id),
    markdown,
    page,
    critPostCount: critPosts,
    referenceCount: references,
  };
}

export const LIST_CRIT_POSTS_TOOL = {
  name: "list_crit_posts",
  description:
    "List the Crit Wall posts for a hub or domain, newest first, with comment counts. Pass hubId or domainId. An anonymous post shows no author unless you posted it. Read or write a post's comments with list_comments and manage_comment (targetType 'crit', targetId the post id).",
  inputSchema: {
    type: "object" as const,
    properties: { ...hubRef, ...pageProps(LIST_LIMITS) },
    additionalProperties: false,
  },
  requiredScope: "mcp:read" as const,
};

export async function runListCritPosts(ctx: McpCtx, input: HubRef & PageArgs) {
  const { hub, domainId, canModerate, viewerId } = await requireDomainHub(ctx, input);
  const window = offsetWindow(input, LIST_LIMITS);
  const fetched = await prisma.critSubmission.findMany({
    where: { domainId },
    include: { author: { select: { firstName: true, lastName: true } } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip: window.skip,
    take: window.take,
  });
  const { rows, page } = offsetPage(fetched, window);
  const counts = await critCommentCounts(rows.map((r) => r.id));
  return {
    posts: rows.map((r) => {
      const { authorName, ...post } = serializeSubmission(r, viewerId, canModerate, counts.get(r.id) ?? 0);
      const reveal = !r.anonymous || r.authorId === viewerId;
      return {
        ...post,
        author: reveal && r.authorId ? { id: r.authorId, name: r.anonymous ? displayName(r.author) : authorName } : null,
        link: critThreadHref(hub.id, { submissionId: r.id }),
      };
    }),
    page,
  };
}

export const LIST_DOMAIN_REFERENCES_TOOL = {
  name: "list_domain_references",
  description:
    "List a domain's References, newest first: work and inspiration members share, with title, link or file, creator credit and note. Pass hubId or domainId. DALI-made references are credited to the member who shared them.",
  inputSchema: {
    type: "object" as const,
    properties: { ...hubRef, ...pageProps(LIST_LIMITS) },
    additionalProperties: false,
  },
  requiredScope: "mcp:read" as const,
};

export async function runListDomainReferences(ctx: McpCtx, input: HubRef & PageArgs) {
  const { hub, domainId, canModerate, viewerId } = await requireDomainHub(ctx, input);
  const window = offsetWindow(input, LIST_LIMITS);
  const fetched = await prisma.domainReference.findMany({
    where: { domainId },
    include: { author: { select: { firstName: true, lastName: true } } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip: window.skip,
    take: window.take,
  });
  const { rows, page } = offsetPage(fetched, window);
  return {
    references: rows.map((r) => serializeReference(r, viewerId, canModerate)),
    hubUrl: `${hubUrl(hub.id)}/references`,
    page,
  };
}

export const MANAGE_DOMAIN_REFERENCE_TOOL = {
  name: "manage_domain_reference",
  description:
    "Add or delete a Reference on a domain's hub, as the References tab does. Actions: 'add' (kind 'link' with an http(s) url, or 'image'/'file' with an upload url from this app; title optional for links, which fall back to the page title; daliMade true credits the member the reference is shared as, otherwise creatorName credits someone else; note up to 400 characters) and 'delete' (your own reference, or any as Core or a lead of the domain). Pass hubId or domainId.",
  inputSchema: {
    type: "object" as const,
    properties: {
      action: { type: "string", enum: ["add", "delete"] },
      ...hubRef,
      kind: { type: "string", enum: ["link", "image", "file"] },
      url: { type: "string", minLength: 1, maxLength: 2000 },
      fileName: { type: "string", maxLength: 200 },
      title: { type: "string", maxLength: 120 },
      daliMade: { type: "boolean", description: "True when the work was made at DALI." },
      creatorName: { type: "string", maxLength: 120, description: "Credit for someone else's work. Ignored when daliMade is true." },
      note: { type: "string", maxLength: 400 },
      referenceId: { type: "string", minLength: 1, description: "For 'delete'." },
    },
    required: ["action"],
    additionalProperties: false,
  },
  requiredScope: "mcp:write" as const,
};

type ManageInput = HubRef & {
  action: "add" | "delete";
  kind?: string;
  url?: string;
  fileName?: string;
  title?: string;
  daliMade?: boolean;
  creatorName?: string;
  note?: string;
  referenceId?: string;
};

export async function runManageDomainReference(ctx: McpCtx, input: ManageInput) {
  const { domainId, canModerate, viewerId } = await requireDomainHub(ctx, input);

  if (input.action === "delete") {
    if (!input.referenceId) throw new McpInvalidError("referenceId is required to delete.");
    const existing = await prisma.domainReference.findFirst({
      where: { id: input.referenceId, domainId },
      select: { id: true, authorId: true },
    });
    if (!existing) throw new McpNotFoundError("Reference not found");
    if (existing.authorId !== viewerId && !canModerate) throw new McpForbiddenError("Only the member who shared it, Core or a domain lead can delete this reference.");
    await prisma.domainReference.delete({ where: { id: existing.id } });
    return { ok: true, deleted: existing.id };
  }

  const form = new FormData();
  form.set("kind", input.kind ?? "");
  form.set("url", input.url ?? "");
  form.set("fileName", input.fileName ?? "");
  form.set("title", input.title ?? "");
  form.set("note", input.note ?? "");
  form.set("creator", input.daliMade ? "mine" : "other");
  form.set("creatorName", input.creatorName ?? "");
  const parsed = parseReferenceForm(form);
  if (!parsed.ok) throw new McpInvalidError(parsed.error);
  if (parsed.value.kind === "link" && limitLinkPreviews(ctx.request, viewerId)) {
    throw new McpError("Too many links added in a short time. Try again in a minute.", 429);
  }
  const { title, previewUrl } = await resolveReference(parsed.value);
  const { kind, url, fileName, creatorName, daliMade, note } = parsed.value;
  const created = await prisma.domainReference.create({
    data: { domainId, authorId: viewerId, kind, url, fileName, previewUrl, title, creatorName, daliMade, note },
    include: { author: { select: { firstName: true, lastName: true } } },
  });
  return { ok: true, reference: serializeReference(created, viewerId, canModerate) };
}
