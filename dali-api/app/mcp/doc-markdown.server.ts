import { prisma } from "~/lib/db.server";
import { markdownToBlocks, type DocBlock, type DocInline } from "~/collab/blocknote-server";
import { collectInlineRefs, downgradeInlineRefs, type DowngradedInlineRef } from "~/collab/inline-refs";
import { rewriteMarkdownImages } from "~/lib/markdown-images.server";
import { LAB_MEMBER_WHERE } from "~/lib/prisma-shapes";
import { McpInvalidError } from "./errors";

export type CheckedBlocks = { blocks: DocBlock[]; warnings: string[] };

function describeDowngrade(ref: DowngradedInlineRef): string {
  if (ref.reason === "projectMismatch") {
    return `Task ${ref.id} is not in the project its link names: "${ref.label}" was written as plain text`;
  }
  const what = ref.type === "mention" ? "member" : ref.type === "pageMention" ? "page" : "task";
  return `No ${what} with id ${ref.id}: "${ref.label}" was written as plain text`;
}

export async function checkInlineRefs(blocks: DocBlock[]): Promise<CheckedBlocks> {
  const refs = collectInlineRefs(blocks);
  if (!refs.userIds.length && !refs.pageIds.length && !refs.taskIds.length) {
    return { blocks, warnings: [] };
  }
  const [users, pages, tasks] = await Promise.all([
    refs.userIds.length
      ? prisma.user.findMany({
          where: { id: { in: refs.userIds }, ...LAB_MEMBER_WHERE, handle: { not: null } },
          select: { id: true, handle: true },
        })
      : [],
    refs.pageIds.length
      ? prisma.page.findMany({ where: { id: { in: refs.pageIds } }, select: { id: true } })
      : [],
    refs.taskIds.length
      ? prisma.task.findMany({ where: { id: { in: refs.taskIds } }, select: { id: true, projectId: true } })
      : [],
  ]);
  const result = downgradeInlineRefs(blocks, {
    userIds: new Set(users.map((u) => u.id)),
    pageIds: new Set(pages.map((p) => p.id)),
    taskIds: new Set(tasks.map((t) => t.id)),
    userLabels: new Map(users.map((u) => [u.id, u.handle!])),
    taskProjects: new Map(tasks.map((t) => [t.id, t.projectId])),
  });
  return { blocks: result.blocks, warnings: result.downgraded.map(describeDowngrade) };
}

export const MCP_IMAGE_PREFIX = "uploads/doc-images/mcp/";
export const MCP_MAX_IMAGES = 10;

export async function parseMarkdown(markdown: string): Promise<CheckedBlocks> {
  let blocks: DocBlock[];
  let imageNotes: string[];
  try {
    const images = await rewriteMarkdownImages(markdown, { uploadPrefix: MCP_IMAGE_PREFIX, maxImages: MCP_MAX_IMAGES });
    imageNotes = images.notes;
    blocks = await markdownToBlocks(images.markdown, { inlineRefs: true });
  } catch {
    throw new McpInvalidError("Markdown could not be parsed");
  }
  const checked = await checkInlineRefs(blocks);
  return { blocks: checked.blocks, warnings: [...imageNotes, ...checked.warnings] };
}

export async function parseInlineMarkdown(markdown: string): Promise<{ content: DocInline[]; warnings: string[] }> {
  if (markdown.trim() === "") return { content: [], warnings: [] };
  const { blocks, warnings } = await parseMarkdown(markdown);
  const inline = blocks.length === 1 && Array.isArray(blocks[0]!.content) && !blocks[0]!.children.length;
  if (!inline) {
    throw new McpInvalidError("A table cell takes one line of text, not blocks. Use <br> for a line break.");
  }
  return { content: blocks[0]!.content as DocInline[], warnings };
}
