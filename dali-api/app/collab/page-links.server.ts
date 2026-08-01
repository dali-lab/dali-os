import * as Y from "yjs";
import { prisma } from "~/lib/db";
import { ydocToBlocks } from "./read";

// Backlink index maintenance. Called from the collab store hook (onStoreDocument /
// onDisconnect) — same timing as mention notifications. Reconciles the live
// pageMention nodes in a doc body against the PageLink rows so the index stays
// current without manual curation.
//
// Only `doc:{pageId}:body` rooms carry a mentionable page document.
function parseDocRoom(documentName: string): string | null {
  const m = /^doc:([^:]+):body$/.exec(documentName);
  return m ? m[1]! : null;
}

// Walk a block tree and collect the pageIds of every `pageMention` inline node.
// Uses the same structurally-typed pattern as extractMentionUserIds in
// mentions.server.ts so it tolerates any block shape from either fragment.
export function extractPageMentionIds(doc: Y.Doc): string[] {
  const ids = new Set<string>();
  type InlineNode = { type?: string; props?: Record<string, unknown>; content?: unknown };
  const walkInline = (node: unknown) => {
    if (node == null || typeof node !== "object") return;
    const inline = node as InlineNode;
    if (inline.type === "pageMention") {
      const pageId = inline.props?.pageId;
      if (typeof pageId === "string" && pageId) ids.add(pageId);
    }
    if (Array.isArray(inline.content)) inline.content.forEach(walkInline);
  };
  const walkBlock = (block: { content?: unknown; children?: unknown[] }) => {
    const content = block.content;
    if (Array.isArray(content)) {
      content.forEach(walkInline);
    } else if (content && typeof content === "object") {
      const rows = (content as { rows?: { cells?: unknown[] }[] }).rows ?? [];
      for (const row of rows) {
        for (const cell of row.cells ?? []) {
          if (Array.isArray(cell)) cell.forEach(walkInline);
          else if (cell && typeof cell === "object") {
            const cellContent = (cell as { content?: unknown[] }).content;
            if (Array.isArray(cellContent)) cellContent.forEach(walkInline);
          }
        }
      }
    }
    for (const child of block.children ?? []) walkBlock(child as typeof block);
  };
  // Clone so any Y.XmlText comment-mark side effects don't touch the live doc.
  const clone = new Y.Doc();
  try {
    Y.applyUpdate(clone, Y.encodeStateAsUpdate(doc));
    for (const block of ydocToBlocks(clone).blocks) walkBlock(block);
  } finally {
    clone.destroy();
  }
  return [...ids];
}

/**
 * Reconcile the PageLink index for a single document. Creates rows for newly
 * added page mentions and deletes rows for page mentions that were removed.
 * Best-effort: never throws into the store hook.
 */
export async function reconcilePageLinks(
  documentName: string,
  doc: Y.Doc,
): Promise<void> {
  const fromPageId = parseDocRoom(documentName);
  if (!fromPageId) return;

  const referencedIds = extractPageMentionIds(doc);

  // Fetch current links from the index so we can diff.
  const existing = await prisma.pageLink.findMany({
    where: { fromPageId },
    select: { toPageId: true },
  });
  const existingSet = new Set(existing.map((r) => r.toPageId));
  const newSet = new Set(referencedIds);

  const toAdd = referencedIds.filter((id) => !existingSet.has(id));
  const toRemove = [...existingSet].filter((id) => !newSet.has(id));

  const ops: Promise<unknown>[] = [];

  if (toAdd.length > 0) {
    // Only create links to pages that actually exist (guards against stale
    // labels from pages that were deleted after the mention was inserted).
    const existing = await prisma.page.findMany({
      where: { id: { in: toAdd } },
      select: { id: true },
    });
    const validIds = existing.map((p) => p.id);
    if (validIds.length > 0) {
      ops.push(
        prisma.pageLink.createMany({
          data: validIds.map((toPageId) => ({ fromPageId, toPageId })),
          skipDuplicates: true,
        }),
      );
    }
  }

  if (toRemove.length > 0) {
    ops.push(
      prisma.pageLink.deleteMany({
        where: { fromPageId, toPageId: { in: toRemove } },
      }),
    );
  }

  if (ops.length > 0) await Promise.all(ops);
}
