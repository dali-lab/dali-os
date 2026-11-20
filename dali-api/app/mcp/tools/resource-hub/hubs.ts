import { prisma } from "~/lib/db.server";
import { readDocAsBlocks } from "~/collab/read";
import { blocksToMarkdown } from "~/collab/blocknote-server";
import { resourceHubRoomName } from "~/collab/roomName";
import { loadHubAccess, ledDomainIds, resourceHubViewer, type HubAccess } from "~/resource-hub/lib/resource-hub.server";
import type { McpCtx } from "../../registry";
import { McpInvalidError, McpNotFoundError } from "../../errors";
import { TEXT_PAGE_LIMITS, pageProps, pageText, type PageArgs } from "../../pagination";

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
    "One Resource Hub: title, domain, published state and its page as Markdown. Pass hubId or domainId. A draft hub is not found unless you can edit it. Long pages come back in chunks of limit characters: pass page.nextCursor as cursor until page.hasMore is false.",
  inputSchema: {
    type: "object" as const,
    properties: { ...hubRef, ...pageProps(TEXT_PAGE_LIMITS) },
    additionalProperties: false,
  },
  requiredScope: "mcp:read" as const,
};

export async function runGetResourceHub(ctx: McpCtx, input: HubRef & PageArgs) {
  const { hub, canEdit } = await requireHub(ctx, input);
  const blocks = await readDocAsBlocks(resourceHubRoomName(hub.id));
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
  };
}
