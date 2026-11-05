import { prisma } from "~/lib/db.server";
import { getUserRoles } from "~/lib/roles";
import { isFeatureEnabled } from "~/lib/feature-flags.server";
import { authorizeCollabDoc } from "~/lib/collabAuth";
import { findBlogPost } from "~/lib/blog-post.server";
import { blocksToMarkdown, markdownToBlocks, type DocBlock } from "~/collab/blocknote-server";
import { blogPostRoomName, pageDocName } from "~/collab/roomName";
import {
  DocEditError,
  applyDocOps,
  blockHash,
  getDocBlocks,
  outlineDoc,
  type DocBlockInput,
  type DocOp,
  type DocPosition,
} from "~/collab/edit.server";
import {
  AgentBlockNotFoundError,
  agentAnnouncer,
  announceAgent,
  docViewerCount,
  pagePresenceRoom,
  pointAgent,
} from "~/collab/agent-presence.server";
import type { McpCtx, McpTool } from "../../registry";
import { McpError, McpForbiddenError, McpInvalidError, McpNotFoundError } from "../../errors";
import { checkInlineRefs, parseInlineMarkdown, parseMarkdown } from "../../doc-markdown.server";
import { pageArray, pageProps, type PageArgs } from "../../pagination";
import { loadEditablePage } from "../set-page-content";
import { requireViewer } from "./blog-posts";

const FLAG = "mcp-block-edits";
const MAX_OPS = 50;
const MAX_GET_BLOCKS = 100;
const OUTLINE_LIMITS = { defaultLimit: 200, maxLimit: 1000 };

type Target = { type: "page" | "blogPost"; id: string };
type ResolvedTarget = { docName: string; presenceRoom?: string; pageId?: string };

const TARGET_SCHEMA = {
  type: "object" as const,
  description: "The document: { type: 'page', id: pageId } or { type: 'blogPost', id: postId }.",
  properties: {
    type: { type: "string", enum: ["page", "blogPost"] },
    id: { type: "string", minLength: 1 },
  },
  required: ["type", "id"],
  additionalProperties: false,
};

async function requireFlag(ctx: McpCtx) {
  const roles = await getUserRoles(ctx.user.id, ctx.request);
  if (!(await isFeatureEnabled(FLAG, ctx.user.id, roles, ctx.request))) {
    throw new McpForbiddenError("Block-level editing is not turned on for you yet. Use read_page / set_page_content.");
  }
}

async function resolveTarget(callerId: string, target: Target, mode: "read" | "write"): Promise<ResolvedTarget> {
  if (target.type === "blogPost") {
    const found = await findBlogPost(await requireViewer(callerId), target.id);
    if (!found) throw new McpNotFoundError("Post not found");
    if (mode === "write" && !found.canEdit) throw new McpForbiddenError();
    return { docName: blogPostRoomName(found.post.id) };
  }
  if (mode === "write") {
    const page = await loadEditablePage(callerId, target.id);
    return {
      docName: page.contentDocId ?? pageDocName(page.id),
      presenceRoom: pagePresenceRoom(page.id),
      pageId: page.id,
    };
  }
  const page = await prisma.page.findUnique({
    where: { id: target.id },
    select: { id: true, kind: true, contentDocId: true },
  });
  if (!page) throw new McpNotFoundError("Page not found");
  if (page.kind !== "FreeForm") throw new McpInvalidError(`${page.kind} pages have no block body`);
  if (!(await authorizeCollabDoc(callerId, pageDocName(page.id))).allowed) throw new McpForbiddenError();
  return {
    docName: page.contentDocId ?? pageDocName(page.id),
    presenceRoom: pagePresenceRoom(page.id),
    pageId: page.id,
  };
}

// ─── outline_content ─────────────────────────────────────────────────────────

export const OUTLINE_CONTENT_TOOL = {
  name: "outline_content",
  description:
    "List a page's or blog post's blocks, one row each: id, type, depth, parentId, an 80-character text preview, childCount, table size, and hash. Start here before edit_content: it gives you block ids and the hashes edit_content checks. Then fetch only the blocks you need with get_content_blocks.",
  inputSchema: {
    type: "object" as const,
    properties: { target: TARGET_SCHEMA, ...pageProps(OUTLINE_LIMITS) },
    required: ["target"],
    additionalProperties: false,
  },
  requiredScope: "mcp:read" as const,
};

export async function runOutlineContent(ctx: McpCtx, input: PageArgs & { target: Target }) {
  await requireFlag(ctx);
  const resolved = await resolveTarget(ctx.user.id, input.target, "read");
  const { blocks } = await outlineDoc(resolved.docName);
  const { rows, page } = pageArray(blocks, input, OUTLINE_LIMITS);
  if (resolved.presenceRoom) void announceAgent({ action: "reading", presenceRoom: resolved.presenceRoom });
  return { target: input.target, blocks: rows, page };
}

// ─── get_content_blocks ──────────────────────────────────────────────────────

export const GET_CONTENT_BLOCKS_TOOL = {
  name: "get_content_blocks",
  description:
    "Read chosen blocks of a page or blog post, each with its hash. format 'markdown' (default) returns each block as Markdown, including its children; mentions read as [@Name](/members/<id>), page links as [Title](/documents/<id>). markdownSafe: false means Markdown can't hold that block exactly (callouts, toggles, columns, embeds, signing fields); edit those with JSON (the 'json' field is included for them). format 'json' returns BlockNote JSON for every block. Omit blockIds for every top-level block.",
  inputSchema: {
    type: "object" as const,
    properties: {
      target: TARGET_SCHEMA,
      blockIds: { type: "array", items: { type: "string", minLength: 1 }, maxItems: MAX_GET_BLOCKS },
      format: { type: "string", enum: ["markdown", "json"] },
    },
    required: ["target"],
    additionalProperties: false,
  },
  requiredScope: "mcp:read" as const,
};

async function isMarkdownSafe(block: DocBlock): Promise<boolean> {
  try {
    const own = await markdownToBlocks(await blocksToMarkdown([{ ...block, children: [] }]));
    return own.length === 1 && blockHash(own[0]!) === blockHash(block);
  } catch {
    return false;
  }
}

export async function runGetContentBlocks(
  ctx: McpCtx,
  input: { target: Target; blockIds?: string[]; format?: "markdown" | "json" },
) {
  await requireFlag(ctx);
  const resolved = await resolveTarget(ctx.user.id, input.target, "read");
  let found;
  try {
    found = await getDocBlocks(resolved.docName, input.blockIds);
  } catch (err) {
    throw toMcpError(err);
  }
  const blocks = await Promise.all(
    found.map(async ({ block, hash }) => {
      if (input.format === "json") return { id: block.id, type: block.type, hash, json: block };
      const markdown = await blocksToMarkdown([block]);
      const markdownSafe = await isMarkdownSafe(block);
      return {
        id: block.id,
        type: block.type,
        hash,
        markdown,
        markdownSafe,
        ...(markdownSafe ? {} : { json: block }),
      };
    }),
  );
  if (resolved.presenceRoom) void announceAgent({ action: "reading", presenceRoom: resolved.presenceRoom });
  return { target: input.target, blocks };
}

// ─── edit_content ────────────────────────────────────────────────────────────

type InputPosition = {
  after?: string;
  before?: string;
  firstChildOf?: string;
  lastChildOf?: string;
  start?: boolean;
  end?: boolean;
};

type InputOp = {
  op: string;
  blockId?: string;
  expectedHash?: string;
  position?: InputPosition;
  markdown?: string;
  block?: { type?: string; props?: Record<string, unknown>; content?: unknown };
  blocks?: DocBlockInput[];
  children?: DocBlockInput[];
  find?: string;
  replace?: string;
  index?: number;
  row?: number;
  col?: number;
  cells?: string[];
};

const OP_NAMES = [
  "replace_text",
  "update",
  "insert",
  "delete",
  "move",
  "replace_all",
  "insert_row",
  "delete_row",
  "set_cell",
] as const;

const POSITION_SCHEMA = {
  type: "object" as const,
  description: "Exactly one of: after, before, firstChildOf, lastChildOf (a block id), start: true, end: true.",
  properties: {
    after: { type: "string" },
    before: { type: "string" },
    firstChildOf: { type: "string" },
    lastChildOf: { type: "string" },
    start: { type: "boolean" },
    end: { type: "boolean" },
  },
  additionalProperties: false,
};

export const EDIT_CONTENT_TOOL = {
  name: "edit_content",
  description: [
    "Edit part of a page or blog post without resending the whole body. Ops apply in order, all or none, live to anyone who has it open (they see your caret and the blocks you touched), and the old version stays in version history. Read block ids and hashes with outline_content / get_content_blocks first; every op on an existing block needs that block's expectedHash, and a stale one fails with BLOCK_CHANGED plus the block's current content and hash.",
    "Ops:",
    "replace_text {blockId, expectedHash, find, replace}: find must occur exactly once in the block's own text (not in children, not across a mention or line break). The cheapest edit; keeps formatting and comments around it.",
    "update {blockId, expectedHash, markdown | block}: replace one block's content (markdown must be one block); its children stay unless you pass children.",
    "insert {position, markdown | blocks}: new blocks at position.",
    "delete {blockId, expectedHash}: a block and its children.",
    "move {blockId, expectedHash, position}.",
    "replace_all {markdown | blocks}: the whole body; must be the only op.",
    "Tables: insert_row {blockId, expectedHash, index?, cells: [markdown per cell]} (index omitted appends), delete_row {blockId, expectedHash, index}, set_cell {blockId, expectedHash, row, col, markdown}. Rows and columns count from 0, header row included.",
    "Markdown: mentions are [@Name](/members/<userId>), page links [Title](/documents/<pageId>); an unknown id is written as plain text and reported in warnings. Use <br> for a line break in a table cell. JSON blocks use BlockNote's block shape.",
    "Returns the new hash of every block you touched, so a follow-up edit needs no re-read, and seenBy: how many people have it open (null when unknown).",
  ].join("\n"),
  inputSchema: {
    type: "object" as const,
    properties: {
      target: TARGET_SCHEMA,
      ops: {
        type: "array",
        minItems: 1,
        maxItems: MAX_OPS,
        items: {
          type: "object",
          properties: {
            op: { type: "string", enum: [...OP_NAMES] },
            blockId: { type: "string" },
            expectedHash: { type: "string" },
            position: POSITION_SCHEMA,
            markdown: { type: "string", maxLength: 300_000 },
            block: { type: "object" },
            blocks: { type: "array", items: { type: "object" } },
            children: { type: "array", items: { type: "object" } },
            find: { type: "string", minLength: 1 },
            replace: { type: "string" },
            index: { type: "integer", minimum: 0 },
            row: { type: "integer", minimum: 0 },
            col: { type: "integer", minimum: 0 },
            cells: { type: "array", items: { type: "string" } },
          },
          required: ["op"],
          additionalProperties: false,
        },
      },
    },
    required: ["target", "ops"],
    additionalProperties: false,
  },
  requiredScope: "mcp:write" as const,
};

function need<T>(value: T | undefined, op: InputOp, i: number, field: string): T {
  if (value === undefined || value === null) {
    throw new McpInvalidError(`ops[${i}] (${op.op}) needs ${field}`);
  }
  return value;
}

function toPosition(position: InputPosition | undefined, op: InputOp, i: number): DocPosition {
  const p = need(position, op, i, "position");
  const set = (["after", "before", "firstChildOf", "lastChildOf", "start", "end"] as const).filter(
    (k) => p[k] !== undefined && p[k] !== false,
  );
  if (set.length !== 1) {
    throw new McpInvalidError(`ops[${i}].position needs exactly one of after, before, firstChildOf, lastChildOf, start, end`);
  }
  const key = set[0]!;
  if (key === "start" || key === "end") return { [key]: true } as DocPosition;
  return { [key]: p[key] } as DocPosition;
}

async function bodyBlocks(op: InputOp, i: number, warnings: string[]): Promise<DocBlockInput[]> {
  if (op.markdown !== undefined && op.blocks !== undefined) {
    throw new McpInvalidError(`ops[${i}] (${op.op}) takes markdown or blocks, not both`);
  }
  if (op.markdown !== undefined) {
    const parsed = await parseMarkdown(op.markdown);
    warnings.push(...parsed.warnings);
    return parsed.blocks;
  }
  const blocks = need(op.blocks, op, i, "markdown or blocks");
  const checked = await checkInlineRefs(blocks as DocBlock[]);
  warnings.push(...checked.warnings);
  return checked.blocks;
}

async function toEngineOp(op: InputOp, i: number, warnings: string[]): Promise<DocOp> {
  const blockId = () => need(op.blockId, op, i, "blockId");
  const base = () => ({ blockId: blockId(), expectedHash: op.expectedHash });
  switch (op.op) {
    case "replace_text":
      return { op: "replace_text", ...base(), find: need(op.find, op, i, "find"), replace: need(op.replace, op, i, "replace") };
    case "update": {
      let block: { type?: string; props?: Record<string, unknown>; content?: DocBlock["content"] };
      if (op.markdown !== undefined) {
        const parsed = await parseMarkdown(op.markdown);
        warnings.push(...parsed.warnings);
        if (parsed.blocks.length !== 1 || parsed.blocks[0]!.children.length) {
          throw new McpInvalidError(`ops[${i}] (update) markdown must be exactly one block; use insert to add more`);
        }
        const { type, props, content } = parsed.blocks[0]!;
        block = { type, props, content };
      } else {
        const given = need(op.block, op, i, "markdown or block");
        const checked = await checkInlineRefs([{ id: "x", type: given.type ?? "paragraph", props: given.props ?? {}, content: given.content as DocBlock["content"], children: [] }]);
        warnings.push(...checked.warnings);
        block = { ...given, ...(given.content !== undefined ? { content: checked.blocks[0]!.content } : {}) } as typeof block;
      }
      let children: DocBlockInput[] | undefined;
      if (op.children !== undefined) {
        const checked = await checkInlineRefs(op.children as DocBlock[]);
        warnings.push(...checked.warnings);
        children = checked.blocks;
      }
      return { op: "update", ...base(), block, ...(children ? { children } : {}) };
    }
    case "insert":
      return { op: "insert", position: toPosition(op.position, op, i), blocks: await bodyBlocks(op, i, warnings) };
    case "delete":
      return { op: "delete", ...base() };
    case "move":
      return { op: "move", ...base(), position: toPosition(op.position, op, i) };
    case "replace_all":
      return { op: "replace_all", blocks: await bodyBlocks(op, i, warnings) };
    case "insert_row": {
      const cells = [];
      for (const cell of need(op.cells, op, i, "cells")) {
        const parsed = await parseInlineMarkdown(cell);
        warnings.push(...parsed.warnings);
        cells.push(parsed.content);
      }
      return { op: "insert_row", ...base(), ...(op.index !== undefined ? { index: op.index } : {}), cells };
    }
    case "delete_row":
      return { op: "delete_row", ...base(), index: need(op.index, op, i, "index") };
    case "set_cell": {
      const parsed = await parseInlineMarkdown(need(op.markdown, op, i, "markdown"));
      warnings.push(...parsed.warnings);
      return { op: "set_cell", ...base(), row: need(op.row, op, i, "row"), col: need(op.col, op, i, "col"), content: parsed.content };
    }
    default:
      throw new McpInvalidError(`ops[${i}]: unknown op '${op.op}'`);
  }
}

const NOT_FOUND_CODES = new Set(["BLOCK_NOT_FOUND"]);

function toMcpError(err: unknown): unknown {
  if (err instanceof AgentBlockNotFoundError) {
    return new McpNotFoundError(`BLOCK_NOT_FOUND: ${err.message}. See outline_content.`);
  }
  if (!(err instanceof DocEditError)) return err;
  const where = err.opIndex !== null ? ` (ops[${err.opIndex}])` : "";
  let message = `${err.code}${where}: ${err.message}`;
  if (err.code === "BLOCK_CHANGED" && err.current) {
    message += `\nCurrent hash: ${err.current.hash}\nCurrent block (JSON): ${JSON.stringify(err.current.block)}`;
  }
  if (err.code === "BLOCK_NOT_FOUND") message += " See outline_content.";
  return NOT_FOUND_CODES.has(err.code) ? new McpNotFoundError(message) : new McpError(message, 409);
}

export async function runEditContent(ctx: McpCtx, input: { target: Target; ops: InputOp[] }) {
  await requireFlag(ctx);
  const resolved = await resolveTarget(ctx.user.id, input.target, "write");
  const warnings: string[] = [];
  const ops: DocOp[] = [];
  for (const [i, op] of input.ops.entries()) ops.push(await toEngineOp(op, i, warnings));

  const announce = await agentAnnouncer();
  let result;
  try {
    result = await applyDocOps(resolved.docName, ops, ctx.user.id, {
      onApplied: (r) =>
        announce({
          action: "editing",
          docRoom: resolved.docName,
          presenceRoom: resolved.presenceRoom,
          range: r.range,
          touched: r.touched,
        }),
    });
  } catch (err) {
    throw toMcpError(err);
  }

  if (resolved.pageId) {
    await prisma.page.update({ where: { id: resolved.pageId }, data: { lastEditedById: ctx.user.id } });
  }

  return {
    target: input.target,
    results: result.results,
    hashes: result.hashes,
    seenBy: docViewerCount(resolved.docName),
    ...(warnings.length ? { warnings } : {}),
  };
}

// ─── point_at_content ────────────────────────────────────────────────────────

type PointInput = { blockId?: string; offset?: number; at?: "start" | "end" };

const POINT_PROPS = {
  offset: { type: "integer", minimum: 0, description: "Characters into the block's own text (clamped). Wins over at." },
  at: { type: "string", enum: ["start", "end"], description: "Without offset: 'start' or 'end' (default) of the block's text." },
};

export const POINT_AT_CONTENT_TOOL = {
  name: "point_at_content",
  description:
    "Put your caret, or a selection, in a page or blog post people have open, to show them what you're looking at or about to change. Changes no content. Everyone with it open sees it under your name and colour for about a minute. blockId comes from outline_content. selectTo selects from the caret to a second point (its blockId defaults to the same block). edit_content already leaves your caret after what it wrote. Returns seenBy: how many people have it open (null when unknown); 0 means nobody saw it.",
  inputSchema: {
    type: "object" as const,
    properties: {
      target: TARGET_SCHEMA,
      blockId: { type: "string", minLength: 1 },
      ...POINT_PROPS,
      selectTo: {
        type: "object",
        properties: { blockId: { type: "string", minLength: 1 }, ...POINT_PROPS },
        additionalProperties: false,
      },
    },
    required: ["target", "blockId"],
    additionalProperties: false,
  },
  requiredScope: "mcp:write" as const,
};

export async function runPointAtContent(
  ctx: McpCtx,
  input: { target: Target; blockId: string; offset?: number; at?: "start" | "end"; selectTo?: PointInput },
) {
  await requireFlag(ctx);
  const resolved = await resolveTarget(ctx.user.id, input.target, "write");
  try {
    const { seen } = pointAgent({
      docRoom: resolved.docName,
      presenceRoom: resolved.presenceRoom,
      blockId: input.blockId,
      ...(input.offset !== undefined ? { offset: input.offset } : {}),
      ...(input.at ? { at: input.at } : {}),
      ...(input.selectTo ? { selectTo: input.selectTo } : {}),
    });
    return {
      target: input.target,
      seenBy: seen,
      ...(seen === 0 ? { note: "Nobody has it open right now, so no one sees this." } : {}),
    };
  } catch (err) {
    throw toMcpError(err);
  }
}

export const DOC_CONTENT_TOOLS: McpTool[] = [
  { def: OUTLINE_CONTENT_TOOL, run: (ctx, args) => runOutlineContent(ctx, args as never) },
  { def: GET_CONTENT_BLOCKS_TOOL, run: (ctx, args) => runGetContentBlocks(ctx, args as never) },
  { def: EDIT_CONTENT_TOOL, run: (ctx, args) => runEditContent(ctx, args as never) },
  { def: POINT_AT_CONTENT_TOOL, run: (ctx, args) => runPointAtContent(ctx, args as never) },
];
