import { getUserRoles } from "~/lib/roles";
import { findHelpArticle, visibleHelpArticles } from "~/help/library.server";
import { McpNotFoundError } from "../errors";
import type { McpCtx } from "../registry";

export const READ_HELP_TOOL = {
  name: "read_help",
  description:
    "Read the DALI OS help: how the platform works and how to do things in it (booking rooms, staffing, hiring, Drive, settings and so on). Without a slug, lists the articles you can see (slug, title, summary). With a slug, returns that article in Markdown. Read-only.",
  inputSchema: {
    type: "object" as const,
    properties: {
      slug: { type: "string", description: "An article's slug from the list. Omit to list articles." },
    },
    additionalProperties: false,
  },
  requiredScope: "mcp:read" as const,
};

export async function runReadHelp(ctx: Pick<McpCtx, "user" | "request">, args: { slug?: string }) {
  const viewer = { userId: ctx.user.id, roles: await getUserRoles(ctx.user.id, ctx.request), request: ctx.request };
  if (!args.slug) {
    const articles = await visibleHelpArticles(viewer);
    return { articles: articles.map((a) => ({ slug: a.slug, title: a.title, summary: a.summary })) };
  }
  const article = await findHelpArticle(viewer, args.slug);
  if (!article) throw new McpNotFoundError(`No help article "${args.slug}". Call read_help without a slug to list them.`);
  return { slug: article.slug, title: article.title, url: article.url, body: article.body };
}
