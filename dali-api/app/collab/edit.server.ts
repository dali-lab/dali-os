import { createHash, randomUUID } from "node:crypto";
import * as Y from "yjs";
import { blocksToPlainText } from "~/components/doc/schema/configs";
import { getCollabServer } from "./server";
import { loadPersistedDoc, transactCollabDoc } from "./write";
import { saveVersion } from "./persistence";
import { stripCommentFormats } from "./comment-formats";
import {
  BLOCKNOTE_FRAGMENT,
  LEGACY_PM_FRAGMENT,
  blocksToFragment,
  fragmentToBlocks,
  serverSchema,
  type DocBlock,
  type DocInline,
  type DocTableContent,
} from "./blocknote-server";

export type DocEditErrorCode =
  | "BLOCK_CHANGED"
  | "BLOCK_NOT_FOUND"
  | "TEXT_NOT_FOUND"
  | "TEXT_AMBIGUOUS"
  | "TEXT_SPANS_INLINE"
  | "ROW_OUT_OF_RANGE"
  | "CELL_OUT_OF_RANGE"
  | "NOT_A_TABLE"
  | "TABLE_HAS_MERGED_CELLS"
  | "ID_EXISTS"
  | "INVALID_OP"
  | "LEGACY_DOC";

export type CurrentBlock = { block: DocBlock; hash: string; treeHash?: string };

export class DocEditError extends Error {
  readonly code: DocEditErrorCode;
  readonly opIndex: number | null;
  readonly blockId?: string;
  readonly current?: CurrentBlock;

  constructor(
    code: DocEditErrorCode,
    message: string,
    details: { opIndex?: number | null; blockId?: string; current?: CurrentBlock } = {},
  ) {
    super(message);
    this.name = "DocEditError";
    this.code = code;
    this.opIndex = details.opIndex ?? null;
    this.blockId = details.blockId;
    this.current = details.current;
  }
}

export interface DocBlockInput {
  id?: string;
  type: string;
  props?: Record<string, unknown>;
  content?: DocBlock["content"];
  children?: DocBlockInput[];
}

export type DocPosition =
  | { after: string }
  | { before: string }
  | { start: true }
  | { end: true }
  | { firstChildOf: string }
  | { lastChildOf: string };

type Checked = { blockId: string; expectedHash?: string };
type TreeChecked = Checked & { expectedTreeHash?: string };

export type DocOp =
  | (TreeChecked & {
      op: "update";
      block: { type?: string; props?: Record<string, unknown>; content?: DocBlock["content"] };
      children?: DocBlockInput[];
    })
  | { op: "insert"; position: DocPosition; blocks: DocBlockInput[] }
  | (TreeChecked & { op: "delete" })
  | (TreeChecked & { op: "move"; position: DocPosition })
  | (Checked & { op: "replace_text"; find: string; replace: string })
  | { op: "replace_all"; blocks: DocBlockInput[] }
  | (Checked & { op: "insert_row"; index?: number; cells: DocInline[][] })
  | (Checked & { op: "delete_row"; index: number })
  | (Checked & { op: "set_cell"; row: number; col: number; content: DocInline[] });

export interface TextRange {
  start: unknown;
  end: unknown;
}

export interface DocEditResult {
  touched: string[];
  hashes: Record<string, string>;
  treeHashes: Record<string, string>;
  range: TextRange | null;
  results: Array<{ op: string; blockIds: string[] }>;
}

export interface OutlineBlock {
  id: string;
  type: string;
  depth: number;
  parentId: string | null;
  preview: string;
  childCount: number;
  hash: string;
  treeHash?: string;
  table?: { rows: number; cols: number };
}

const BLOCK_NODES = new Set(["blockContainer", "columnList", "column"]);
const PREVIEW_MAX = 80;
const UNDO_LABEL = "Before agent edit";
const LEGACY_MESSAGE =
  "This document is in the old editor format. Open the page in the editor once, or use set_page_content, before editing it block by block.";

const blockSchema = serverSchema.blockSchema as unknown as Record<string, { content: string }>;

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
        .map((k) => [k, canonical((value as Record<string, unknown>)[k])]),
    );
  }
  return value;
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex").slice(0, 12);
}

export function blockHash(block: Pick<DocBlock, "type" | "props" | "content">): string {
  return digest({ type: block.type, props: block.props ?? {}, content: block.content ?? null });
}

export function blockTreeHash(block: DocBlock): string {
  const tree = (b: DocBlock): unknown => ({
    id: b.id,
    type: b.type,
    props: b.props ?? {},
    content: b.content ?? null,
    children: (b.children ?? []).map(tree),
  });
  return digest(tree(block));
}

function hashes(block: DocBlock): CurrentBlock {
  return {
    block,
    hash: blockHash(block),
    ...(block.children?.length ? { treeHash: blockTreeHash(block) } : {}),
  };
}

function isLegacy(doc: Y.Doc): boolean {
  return doc.getXmlFragment(BLOCKNOTE_FRAGMENT).length === 0 && doc.getXmlFragment(LEGACY_PM_FRAGMENT).length > 0;
}

// ─── Reads ───────────────────────────────────────────────────────────────────

async function readBlocks(name: string): Promise<DocBlock[]> {
  const doc = new Y.Doc();
  try {
    const loaded = getCollabServer()?.hocuspocus.documents.get(name);
    if (loaded) Y.applyUpdate(doc, Y.encodeStateAsUpdate(loaded));
    else await loadPersistedDoc(name, doc);
    if (isLegacy(doc)) throw new DocEditError("LEGACY_DOC", LEGACY_MESSAGE);
    const fragment = doc.getXmlFragment(BLOCKNOTE_FRAGMENT);
    doc.transact(() => stripCommentFormats(fragment));
    return fragmentToBlocks(fragment);
  } finally {
    doc.destroy();
  }
}

function preview(block: DocBlock): string {
  const text = blocksToPlainText([{ ...block, children: [] }]).replace(/\s+/g, " ").trim();
  return text.length > PREVIEW_MAX ? `${text.slice(0, PREVIEW_MAX - 1)}…` : text;
}

function tableShape(block: DocBlock): { rows: number; cols: number } | undefined {
  if (block.type !== "table" || !block.content || typeof block.content !== "object") return undefined;
  const rows = (block.content as DocTableContent).rows ?? [];
  const cols = (rows[0]?.cells ?? []).reduce(
    (sum, cell) => sum + (Array.isArray(cell) ? 1 : Number(cell.props?.colspan ?? 1)),
    0,
  );
  return { rows: rows.length, cols };
}

export async function outlineDoc(docName: string): Promise<{ blocks: OutlineBlock[] }> {
  const out: OutlineBlock[] = [];
  const walk = (blocks: DocBlock[], depth: number, parentId: string | null) => {
    for (const block of blocks) {
      const table = tableShape(block);
      const { hash, treeHash } = hashes(block);
      out.push({
        id: block.id,
        type: block.type,
        depth,
        parentId,
        preview: preview(block),
        childCount: block.children?.length ?? 0,
        hash,
        ...(treeHash ? { treeHash } : {}),
        ...(table ? { table } : {}),
      });
      walk(block.children ?? [], depth + 1, block.id);
    }
  };
  walk(await readBlocks(docName), 0, null);
  return { blocks: out };
}

export async function getDocBlocks(docName: string, ids?: string[]): Promise<CurrentBlock[]> {
  const blocks = await readBlocks(docName);
  if (!ids) return blocks.map(hashes);
  const byId = new Map<string, DocBlock>();
  const index = (list: DocBlock[]) => {
    for (const block of list) {
      byId.set(block.id, block);
      index(block.children ?? []);
    }
  };
  index(blocks);
  const missing = ids.filter((id) => !byId.has(id));
  if (missing.length > 0) {
    throw new DocEditError("BLOCK_NOT_FOUND", `No block with id ${missing.join(", ")}`, {
      blockId: missing[0],
    });
  }
  return ids.map((id) => hashes(byId.get(id)!));
}

// ─── Y tree helpers ──────────────────────────────────────────────────────────

type Located = { el: Y.XmlElement; group: Y.XmlElement; index: number };

function topGroup(doc: Y.Doc): Y.XmlElement | null {
  const first = doc.getXmlFragment(BLOCKNOTE_FRAGMENT).get(0);
  return first instanceof Y.XmlElement && first.nodeName === "blockGroup" ? first : null;
}

function ensureTopGroup(doc: Y.Doc): Y.XmlElement {
  const existing = topGroup(doc);
  if (existing) return existing;
  const group = new Y.XmlElement("blockGroup");
  doc.getXmlFragment(BLOCKNOTE_FRAGMENT).insert(0, [group]);
  return group;
}

function isBlockNode(node: unknown): node is Y.XmlElement {
  return node instanceof Y.XmlElement && BLOCK_NODES.has(node.nodeName);
}

function childGroup(el: Y.XmlElement): Y.XmlElement | null {
  if (el.nodeName !== "blockContainer") return el;
  const group = el.get(1);
  return group instanceof Y.XmlElement && group.nodeName === "blockGroup" ? group : null;
}

function hasChildren(el: Y.XmlElement): boolean {
  return (childGroup(el)?.toArray() ?? []).some(isBlockNode);
}

function locateIn(group: Y.XmlElement, id: string): Located | null {
  for (let i = 0; i < group.length; i++) {
    const el = group.get(i);
    if (!isBlockNode(el)) continue;
    if (el.getAttribute("id") === id) return { el, group, index: i };
    const inner = childGroup(el);
    const found = inner ? locateIn(inner, id) : null;
    if (found) return found;
  }
  return null;
}

function locate(doc: Y.Doc, id: string): Located | null {
  const top = topGroup(doc);
  return top ? locateIn(top, id) : null;
}

function collectIds(group: Y.XmlElement | null, into = new Set<string>()): Set<string> {
  if (!group) return into;
  for (const el of group.toArray()) {
    if (!isBlockNode(el)) continue;
    const id = el.getAttribute("id");
    if (typeof id === "string") into.add(id);
    collectIds(childGroup(el), into);
  }
  return into;
}

function blockAncestors(node: Y.XmlElement | Y.XmlText): Y.XmlElement[] {
  const out: Y.XmlElement[] = [];
  for (let p = node.parent; p instanceof Y.XmlElement; p = p.parent) {
    if (isBlockNode(p)) out.push(p);
  }
  return out;
}

function decodeElement(el: Y.XmlElement): DocBlock {
  const tmp = new Y.Doc();
  try {
    const fragment = tmp.getXmlFragment(BLOCKNOTE_FRAGMENT);
    const group = new Y.XmlElement("blockGroup");
    group.insert(0, [el.clone()]);
    fragment.insert(0, [group]);
    tmp.transact(() => stripCommentFormats(fragment));
    return fragmentToBlocks(fragment)[0]!;
  } finally {
    tmp.destroy();
  }
}

function plainText(text: Y.XmlText): string {
  return (text.toDelta() as Array<{ insert?: unknown }>)
    .map((d) => (typeof d.insert === "string" ? d.insert : "￼"))
    .join("");
}

function attributesAt(text: Y.XmlText, offset: number): Record<string, unknown> {
  let pos = 0;
  for (const d of text.toDelta() as Array<{ insert?: unknown; attributes?: Record<string, unknown> }>) {
    const len = typeof d.insert === "string" ? d.insert.length : 1;
    if (offset < pos + len) return { ...(d.attributes ?? {}) };
    pos += len;
  }
  return {};
}

function texts(node: Y.XmlElement): Y.XmlText[] {
  const out: Y.XmlText[] = [];
  for (const child of node.toArray()) {
    if (child instanceof Y.XmlText) out.push(child);
    else if (child instanceof Y.XmlElement) out.push(...texts(child));
  }
  return out;
}

type SpanPoint = { anchor: string; path: number[]; index: number };
type Span = { start: SpanPoint; end: SpanPoint };

function spanPoint(text: Y.XmlText, index: number): SpanPoint | null {
  const path: number[] = [];
  let node: Y.XmlElement | Y.XmlText = text;
  while (node.parent instanceof Y.XmlElement) {
    const parent: Y.XmlElement = node.parent;
    path.unshift(parent.toArray().indexOf(node));
    if (isBlockNode(parent) && typeof parent.getAttribute("id") === "string") {
      return { anchor: parent.getAttribute("id") as string, path, index };
    }
    node = parent;
  }
  return null;
}

function span(start: [Y.XmlText, number], end: [Y.XmlText, number]): Span | null {
  const a = spanPoint(...start);
  const b = spanPoint(...end);
  return a && b ? { start: a, end: b } : null;
}

function textSpan(node: Y.XmlElement): Span | null {
  const filled = texts(node).filter((t) => t.length > 0);
  const first = filled[0];
  const last = filled[filled.length - 1];
  return first && last ? span([first, 0], [last, last.length]) : null;
}

function resolvePoint(doc: Y.Doc, point: SpanPoint): [Y.XmlText, number] | null {
  let node: unknown = locate(doc, point.anchor)?.el;
  for (const i of point.path) {
    if (!(node instanceof Y.XmlElement)) return null;
    node = node.get(i);
  }
  return node instanceof Y.XmlText ? [node, Math.min(point.index, node.length)] : null;
}

function inlineDisplay(el: Y.XmlElement): string {
  if (el.nodeName === "hardBreak") return "\n";
  const label = el.getAttribute("label") ?? el.getAttribute("name");
  const text = typeof label === "string" ? label : "";
  return el.nodeName === "mention" ? `@${text}` : text;
}

function toDocBlock(input: DocBlockInput): DocBlock {
  return {
    id: input.id ?? randomUUID(),
    type: input.type,
    props: input.props ?? {},
    content: input.content,
    children: (input.children ?? []).map(toDocBlock),
  };
}

function withRendered<R>(blocks: DocBlockInput[], opIndex: number, fn: (els: Y.XmlElement[]) => R): R {
  const scratch = new Y.Doc();
  try {
    const fragment = scratch.getXmlFragment(BLOCKNOTE_FRAGMENT);
    try {
      blocksToFragment(blocks.map(toDocBlock), fragment);
    } catch (err) {
      throw new DocEditError("INVALID_OP", `Could not build blocks: ${(err as Error).message}`, { opIndex });
    }
    const group = fragment.get(0) as Y.XmlElement;
    return fn(group.toArray().filter(isBlockNode));
  } finally {
    scratch.destroy();
  }
}

// ─── Ops ─────────────────────────────────────────────────────────────────────

type RunState = {
  rehearsing: boolean;
  touched: string[];
  moved: string[];
  changed: Set<string>;
  dirty: Set<string>;
  spans: Span[];
  results: Array<{ op: string; blockIds: string[] }>;
};

function invalid(opIndex: number, message: string, blockId?: string): DocEditError {
  return new DocEditError("INVALID_OP", message, { opIndex, blockId });
}

function validateBlocks(blocks: unknown, opIndex: number, parentType: string | null): void {
  if (!Array.isArray(blocks)) throw invalid(opIndex, "blocks must be an array");
  for (const block of blocks as DocBlockInput[]) {
    if (!block || typeof block !== "object" || typeof block.type !== "string") {
      throw invalid(opIndex, "every block needs a type");
    }
    if (!blockSchema[block.type]) throw invalid(opIndex, `Unknown block type "${block.type}"`);
    if ((block.type === "column") !== (parentType === "columnList")) {
      throw invalid(opIndex, "column blocks can only sit directly inside a columnList");
    }
    if (block.type === "columnList" && parentType !== null) {
      throw invalid(opIndex, "A column list can only sit at the top level");
    }
    if (block.props !== undefined && (typeof block.props !== "object" || block.props === null)) {
      throw invalid(opIndex, "props must be an object");
    }
    if (block.children !== undefined) validateBlocks(block.children, opIndex, block.type);
  }
}

function assignIds(blocks: DocBlockInput[], taken: Set<string>, opIndex: number): void {
  for (const block of blocks) {
    if (typeof block.id === "string" && block.id) {
      if (taken.has(block.id)) {
        throw new DocEditError("ID_EXISTS", `A block with id ${block.id} already exists; leave id out to get a new one`, {
          opIndex,
          blockId: block.id,
        });
      }
    } else {
      block.id = randomUUID();
    }
    taken.add(block.id);
    assignIds(block.children ?? [], taken, opIndex);
  }
}

function allInputIds(blocks: DocBlockInput[], into: Set<string>): Set<string> {
  for (const block of blocks) {
    if (block.id) into.add(block.id);
    allInputIds(block.children ?? [], into);
  }
  return into;
}

function requireBlock(doc: Y.Doc, id: unknown, opIndex: number): Located {
  if (typeof id !== "string" || !id) throw invalid(opIndex, "blockId is required");
  const found = locate(doc, id);
  if (!found) throw new DocEditError("BLOCK_NOT_FOUND", `No block with id ${id}`, { opIndex, blockId: id });
  return found;
}

function changedError(blockId: string, opIndex: number, current: CurrentBlock, what: string): DocEditError {
  return new DocEditError("BLOCK_CHANGED", `Block ${blockId}${what} changed since it was read`, {
    opIndex,
    blockId,
    current,
  });
}

function checkHash(st: RunState, op: Checked, loc: Located, opIndex: number) {
  if (!st.rehearsing || st.changed.has(op.blockId)) return;
  if (typeof op.expectedHash !== "string" || !op.expectedHash) {
    throw invalid(opIndex, `expectedHash is required for block ${op.blockId}`, op.blockId);
  }
  const current = hashes(decodeElement(loc.el));
  if (current.hash !== op.expectedHash) throw changedError(op.blockId, opIndex, current, "");
}

function checkTreeHash(st: RunState, op: TreeChecked, loc: Located, opIndex: number) {
  if (!st.rehearsing || !hasChildren(loc.el) || st.dirty.has(op.blockId) || st.changed.has(op.blockId)) return;
  if (typeof op.expectedTreeHash !== "string" || !op.expectedTreeHash) {
    throw invalid(opIndex, `expectedTreeHash is required for block ${op.blockId} because it has children`, op.blockId);
  }
  const current = hashes(decodeElement(loc.el));
  if (current.treeHash !== op.expectedTreeHash) throw changedError(op.blockId, opIndex, current, " or its children");
}

function markDirty(st: RunState, el: Y.XmlElement) {
  for (const node of [el, ...blockAncestors(el)]) {
    const id = node.getAttribute("id");
    if (typeof id === "string") st.dirty.add(id);
  }
}

function anchorOf(position: DocPosition): string | null {
  const p = position as Record<string, unknown>;
  for (const key of ["after", "before", "firstChildOf", "lastChildOf"]) {
    if (typeof p[key] === "string") return p[key] as string;
  }
  return null;
}

function resolvePosition(
  doc: Y.Doc,
  position: unknown,
  opIndex: number,
): { group: Y.XmlElement; index: number } {
  const p = (position ?? {}) as Record<string, unknown>;
  const keys = Object.keys(p).filter((k) => p[k] !== undefined);
  if (keys.length !== 1) throw invalid(opIndex, "position needs exactly one of after, before, start, end, firstChildOf, lastChildOf");
  const key = keys[0]!;
  if (key === "start" || key === "end") {
    const top = ensureTopGroup(doc);
    return { group: top, index: key === "start" ? 0 : top.length };
  }
  if (!["after", "before", "firstChildOf", "lastChildOf"].includes(key)) {
    throw invalid(opIndex, `Unknown position "${key}"`);
  }
  const anchor = requireBlock(doc, p[key], opIndex);
  if (key === "after" || key === "before") {
    if (anchor.el.nodeName === "column") {
      throw invalid(opIndex, "Columns can't gain siblings; replace the column list instead", p[key] as string);
    }
    return { group: anchor.group, index: key === "after" ? anchor.index + 1 : anchor.index };
  }
  if (anchor.el.nodeName === "columnList") {
    throw invalid(opIndex, "Insert into a column, not the column list", p[key] as string);
  }
  let group = childGroup(anchor.el);
  if (!group) {
    group = new Y.XmlElement("blockGroup");
    anchor.el.insert(anchor.el.length, [group]);
  }
  return { group, index: key === "firstChildOf" ? 0 : group.length };
}

function checkPlacement(group: Y.XmlElement, types: string[], doc: Y.Doc, opIndex: number) {
  if (types.includes("columnList") && group !== topGroup(doc)) {
    throw invalid(opIndex, "A column list can only sit at the top level");
  }
}

function removeIfEmpty(group: Y.XmlElement) {
  const parent = group.parent;
  if (group.length === 0 && group.nodeName === "blockGroup" && parent instanceof Y.XmlElement) {
    parent.delete(parent.toArray().indexOf(group), 1);
  }
}

function emptyParagraph(): Y.XmlElement {
  return withRendered([{ id: randomUUID(), type: "paragraph" }], -1, ([el]) => el!.clone());
}

function fillEmptyGroups(doc: Y.Doc) {
  const top = topGroup(doc);
  if (!top) return;
  if (top.length === 0) top.insert(0, [emptyParagraph()]);
  const walk = (group: Y.XmlElement) => {
    for (const el of group.toArray()) {
      if (!isBlockNode(el)) continue;
      if (el.nodeName === "column" && el.length === 0) el.insert(0, [emptyParagraph()]);
      const inner = childGroup(el);
      if (inner) walk(inner);
    }
  };
  walk(top);
}

function markChanged(st: RunState, el: Y.XmlElement) {
  const id = el.getAttribute("id");
  if (typeof id === "string") st.changed.add(id);
  collectIds(childGroup(el)).forEach((d) => st.changed.add(d));
}

function touch(st: RunState, id: string, s: Span | null) {
  st.touched.push(id);
  st.changed.add(id);
  if (s) st.spans.push(s);
}

function contentKind(type: string): string {
  return blockSchema[type]!.content;
}

function opInsert(doc: Y.Doc, op: Extract<DocOp, { op: "insert" }>, i: number, st: RunState) {
  validateBlocks(op.blocks, i, null);
  if (op.blocks.length === 0) throw invalid(i, "insert needs at least one block");
  if (st.rehearsing) assignIds(op.blocks, collectIds(topGroup(doc)), i);
  const { group, index } = resolvePosition(doc, op.position, i);
  checkPlacement(group, op.blocks.map((b) => b.type), doc, i);
  const inserted = withRendered(op.blocks, i, (els) => els.map((el) => el.clone()));
  group.insert(index, inserted);
  const ids: string[] = [];
  for (const el of inserted) {
    const id = el.getAttribute("id") as string;
    ids.push(id);
    markChanged(st, el);
    markDirty(st, el);
    touch(st, id, null);
  }
  const first = inserted.map(textSpan).find(Boolean);
  const last = inserted.map(textSpan).reverse().find(Boolean);
  if (first && last) st.spans.push({ start: first.start, end: last.end });
  st.results.push({ op: "insert", blockIds: ids });
}

function opUpdate(doc: Y.Doc, op: Extract<DocOp, { op: "update" }>, i: number, st: RunState) {
  const loc = requireBlock(doc, op.blockId, i);
  if (loc.el.nodeName !== "blockContainer") {
    throw invalid(i, `${loc.el.nodeName} blocks can't be updated; replace them instead`, op.blockId);
  }
  if (op.block !== undefined && (typeof op.block !== "object" || op.block === null)) {
    throw invalid(i, "block must be an object", op.blockId);
  }
  checkHash(st, op, loc, i);
  if (op.children !== undefined) checkTreeHash(st, op, loc, i);
  const patch = op.block ?? {};
  const current = decodeElement(loc.el);
  const type = patch.type ?? current.type;
  if (!blockSchema[type]) throw invalid(i, `Unknown block type "${type}"`, op.blockId);
  if (type === "column" || type === "columnList") throw invalid(i, `Can't turn a block into a ${type}`, op.blockId);
  if (op.children !== undefined) validateBlocks(op.children, i, type);
  if (st.rehearsing && op.children) {
    const taken = collectIds(topGroup(doc));
    collectIds(childGroup(loc.el)).forEach((id) => taken.delete(id));
    taken.add(op.blockId);
    assignIds(op.children, taken, i);
  }

  const contentGiven = patch.content !== undefined;
  const from = contentKind(current.type);
  const to = contentKind(type);
  const keepInline = !contentGiven && from === "inline" && to === "inline";
  let content: DocBlock["content"];
  if (contentGiven) content = patch.content;
  else if (from === to || (from === "plain" && to === "inline")) content = current.content;
  else if (from === "inline" && to === "plain") {
    content = blocksToPlainText([{ type: "paragraph", props: {}, content: current.content, children: [] }]);
  }
  const rendered: DocBlockInput = {
    id: op.blockId,
    type,
    props: { ...current.props, ...(patch.props ?? {}) },
    content,
    children: op.children ?? [],
  };

  withRendered([rendered], i, ([container]) => {
    const fresh = container!.get(0) as Y.XmlElement;
    const live = loc.el.get(0) as Y.XmlElement;
    if (!contentGiven && type === current.type) {
      const next = fresh.getAttributes() as Record<string, unknown>;
      for (const [key, value] of Object.entries(next)) {
        if (JSON.stringify(live.getAttribute(key)) !== JSON.stringify(value)) live.setAttribute(key, value as string);
      }
      for (const key of Object.keys(live.getAttributes())) {
        if (!(key in next)) live.removeAttribute(key);
      }
    } else {
      const replacement = keepInline ? new Y.XmlElement(fresh.nodeName) : fresh.clone();
      if (keepInline) {
        for (const [key, value] of Object.entries(fresh.getAttributes())) replacement.setAttribute(key, value as string);
        replacement.insert(0, live.toArray().map((child) => (child as Y.XmlElement | Y.XmlText).clone()));
      }
      loc.el.delete(0, 1);
      loc.el.insert(0, [replacement]);
    }
    if (op.children !== undefined) {
      if (childGroup(loc.el)) loc.el.delete(1, 1);
      const freshGroup = container!.get(1);
      if (freshGroup instanceof Y.XmlElement) loc.el.insert(1, [freshGroup.clone()]);
    }
  });

  if (op.children !== undefined) markChanged(st, loc.el);
  markDirty(st, loc.el);
  touch(st, op.blockId, textSpan(op.children !== undefined ? loc.el : (loc.el.get(0) as Y.XmlElement)));
  st.results.push({ op: "update", blockIds: [op.blockId] });
}

function opDelete(doc: Y.Doc, op: Extract<DocOp, { op: "delete" }>, i: number, st: RunState) {
  const loc = requireBlock(doc, op.blockId, i);
  if (loc.el.nodeName === "column") throw invalid(i, "Columns can't be deleted on their own; replace the column list", op.blockId);
  checkHash(st, op, loc, i);
  checkTreeHash(st, op, loc, i);
  markDirty(st, loc.el);
  loc.group.delete(loc.index, 1);
  removeIfEmpty(loc.group);
  st.results.push({ op: "delete", blockIds: [op.blockId] });
}

function opMove(doc: Y.Doc, op: Extract<DocOp, { op: "move" }>, i: number, st: RunState) {
  const loc = requireBlock(doc, op.blockId, i);
  if (loc.el.nodeName === "column") throw invalid(i, "Columns can't be moved on their own; move the column list", op.blockId);
  checkHash(st, op, loc, i);
  checkTreeHash(st, op, loc, i);
  const anchor = anchorOf(op.position);
  if (anchor && (anchor === op.blockId || collectIds(childGroup(loc.el)).has(anchor))) {
    throw invalid(i, "A block can't move next to or into itself", op.blockId);
  }
  markDirty(st, loc.el);
  const copy = loc.el.clone();
  loc.group.delete(loc.index, 1);
  removeIfEmpty(loc.group);
  const { group, index } = resolvePosition(doc, op.position, i);
  checkPlacement(group, [loc.el.nodeName === "columnList" ? "columnList" : "block"], doc, i);
  group.insert(index, [copy]);
  markDirty(st, copy);
  st.moved.push(op.blockId);
  st.results.push({ op: "move", blockIds: [op.blockId] });
}

function opReplaceText(doc: Y.Doc, op: Extract<DocOp, { op: "replace_text" }>, i: number, st: RunState) {
  const loc = requireBlock(doc, op.blockId, i);
  if (loc.el.nodeName !== "blockContainer") throw invalid(i, `${loc.el.nodeName} blocks have no text`, op.blockId);
  if (typeof op.find !== "string" || op.find.length === 0) throw invalid(i, "find must be a non-empty string", op.blockId);
  if (typeof op.replace !== "string") throw invalid(i, "replace must be a string", op.blockId);
  if (op.replace.includes("\n")) throw invalid(i, "replace can't contain a line break; use update instead", op.blockId);
  checkHash(st, op, loc, i);

  const node = loc.el.get(0) as Y.XmlElement;
  const parts = node.nodeName === "table" ? [] : node.toArray();
  const matches: Array<{ text: Y.XmlText; offset: number }> = [];
  for (const part of parts) {
    if (!(part instanceof Y.XmlText)) continue;
    const str = plainText(part);
    for (let at = str.indexOf(op.find); at !== -1; at = str.indexOf(op.find, at + 1)) {
      matches.push({ text: part, offset: at });
    }
  }
  if (matches.length > 1) {
    throw new DocEditError("TEXT_AMBIGUOUS", `"${op.find}" occurs ${matches.length} times in block ${op.blockId}`, {
      opIndex: i,
      blockId: op.blockId,
    });
  }
  if (matches.length === 0) {
    const joined = (show: boolean) =>
      parts
        .map((p) => (p instanceof Y.XmlText ? plainText(p) : show ? inlineDisplay(p as Y.XmlElement) : ""))
        .join("");
    const spans = joined(true).includes(op.find) || joined(false).includes(op.find);
    throw new DocEditError(
      spans ? "TEXT_SPANS_INLINE" : "TEXT_NOT_FOUND",
      spans
        ? `"${op.find}" runs across a mention, line break or other inline element in block ${op.blockId}; use update instead`
        : `"${op.find}" is not in block ${op.blockId}${node.nodeName === "table" ? " (use set_cell for table text)" : ""}`,
      { opIndex: i, blockId: op.blockId },
    );
  }

  const { text, offset } = matches[0]!;
  const attributes = attributesAt(text, offset);
  text.delete(offset, op.find.length);
  if (op.replace) text.insert(offset, op.replace, attributes);
  markDirty(st, loc.el);
  touch(st, op.blockId, span([text, offset], [text, offset + op.replace.length]));
  st.results.push({ op: "replace_text", blockIds: [op.blockId] });
}

function requireTable(doc: Y.Doc, op: Checked, i: number, st: RunState) {
  const loc = requireBlock(doc, op.blockId, i);
  const table = loc.el.nodeName === "blockContainer" ? loc.el.get(0) : null;
  if (!(table instanceof Y.XmlElement) || table.nodeName !== "table") {
    throw new DocEditError("NOT_A_TABLE", `Block ${op.blockId} is not a table`, { opIndex: i, blockId: op.blockId });
  }
  checkHash(st, op, loc, i);
  const rows = table.toArray() as Y.XmlElement[];
  const merged = rows.some((row) =>
    (row.toArray() as Y.XmlElement[]).some(
      (cell) => Number(cell.getAttribute("colspan") ?? 1) > 1 || Number(cell.getAttribute("rowspan") ?? 1) > 1,
    ),
  );
  if (merged) {
    throw new DocEditError(
      "TABLE_HAS_MERGED_CELLS",
      `Table ${op.blockId} has merged cells, so rows and columns don't line up; use update on the whole table`,
      { opIndex: i, blockId: op.blockId },
    );
  }
  const current = decodeElement(loc.el);
  markDirty(st, loc.el);
  return { table, rows, current, content: current.content as DocTableContent };
}

function isIndex(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value);
}

function rowOutOfRange(op: { blockId: string }, i: number, row: unknown, count: number) {
  return new DocEditError("ROW_OUT_OF_RANGE", `Row ${String(row)} is out of range; the table has ${count} rows`, {
    opIndex: i,
    blockId: op.blockId,
  });
}

function opInsertRow(doc: Y.Doc, op: Extract<DocOp, { op: "insert_row" }>, i: number, st: RunState) {
  const { table, rows, current, content } = requireTable(doc, op, i, st);
  const index = op.index ?? rows.length;
  if (!isIndex(index) || index < 0 || index > rows.length) throw rowOutOfRange(op, i, index, rows.length);
  const cols = rows[0]?.length ?? 0;
  if (!Array.isArray(op.cells) || op.cells.some((c) => !Array.isArray(c))) {
    throw invalid(i, "cells must be an array of inline content arrays", op.blockId);
  }
  if (op.cells.length !== cols) {
    throw invalid(i, `The table has ${cols} columns but the row has ${op.cells.length} cells`, op.blockId);
  }
  const widths = content.columnWidths?.length === cols ? content.columnWidths : undefined;
  const scratchTable: DocBlockInput = {
    type: "table",
    props: current.props,
    content: {
      type: "tableContent",
      columnWidths: widths,
      headerRows: index < (content.headerRows ?? 0) ? 1 : 0,
      headerCols: content.headerCols,
      rows: [{ cells: op.cells.map((cell) => ({ type: "tableCell" as const, content: cell })) }],
    },
  };
  const row = withRendered([scratchTable], i, ([el]) => ((el!.get(0) as Y.XmlElement).get(0) as Y.XmlElement).clone());
  table.insert(index, [row]);
  touch(st, op.blockId, textSpan(row));
  st.results.push({ op: "insert_row", blockIds: [op.blockId] });
}

function opDeleteRow(doc: Y.Doc, op: Extract<DocOp, { op: "delete_row" }>, i: number, st: RunState) {
  const { table, rows } = requireTable(doc, op, i, st);
  if (!isIndex(op.index) || op.index < 0 || op.index >= rows.length) throw rowOutOfRange(op, i, op.index, rows.length);
  if (rows.length === 1) throw invalid(i, "Can't delete a table's only row; delete the table instead", op.blockId);
  table.delete(op.index, 1);
  touch(st, op.blockId, null);
  st.results.push({ op: "delete_row", blockIds: [op.blockId] });
}

function opSetCell(doc: Y.Doc, op: Extract<DocOp, { op: "set_cell" }>, i: number, st: RunState) {
  const { rows } = requireTable(doc, op, i, st);
  if (!isIndex(op.row) || op.row < 0 || op.row >= rows.length) throw rowOutOfRange(op, i, op.row, rows.length);
  const cells = rows[op.row]!.toArray() as Y.XmlElement[];
  if (!isIndex(op.col) || op.col < 0 || op.col >= cells.length) {
    throw new DocEditError("CELL_OUT_OF_RANGE", `Column ${String(op.col)} is out of range; row ${op.row} has ${cells.length} cells`, {
      opIndex: i,
      blockId: op.blockId,
    });
  }
  if (!Array.isArray(op.content)) throw invalid(i, "content must be an array of inline content", op.blockId);
  const scratchTable: DocBlockInput = {
    type: "table",
    content: { type: "tableContent", rows: [{ cells: [{ type: "tableCell", content: op.content }] }] },
  };
  const cell = cells[op.col]!;
  const fresh = withRendered([scratchTable], i, ([el]) => {
    const scratchCell = ((el!.get(0) as Y.XmlElement).get(0) as Y.XmlElement).get(0) as Y.XmlElement;
    return scratchCell.toArray().map((p) => (p as Y.XmlElement).clone());
  });
  cell.delete(0, cell.length);
  cell.insert(0, fresh);
  touch(st, op.blockId, textSpan(cell));
  st.results.push({ op: "set_cell", blockIds: [op.blockId] });
}

function opReplaceAll(doc: Y.Doc, op: Extract<DocOp, { op: "replace_all" }>, i: number, st: RunState) {
  validateBlocks(op.blocks, i, null);
  if (st.rehearsing) assignIds(op.blocks, new Set(), i);
  try {
    blocksToFragment(op.blocks.map(toDocBlock), doc.getXmlFragment(BLOCKNOTE_FRAGMENT));
  } catch (err) {
    throw invalid(i, `Could not build blocks: ${(err as Error).message}`);
  }
  const top = topGroup(doc);
  const ids = op.blocks.map((b) => b.id as string);
  allInputIds(op.blocks, st.changed);
  allInputIds(op.blocks, st.dirty);
  if (top) {
    const s = textSpan(top);
    for (const id of ids) touch(st, id, null);
    if (s) st.spans.push(s);
  }
  st.results.push({ op: "replace_all", blockIds: ids });
}

function runOps(doc: Y.Doc, ops: DocOp[], rehearsing: boolean): RunState {
  const st: RunState = {
    rehearsing,
    touched: [],
    moved: [],
    changed: new Set(),
    dirty: new Set(),
    spans: [],
    results: [],
  };
  ops.forEach((op, i) => {
    if (!op || typeof op !== "object") throw invalid(i, "Each op must be an object");
    switch (op.op) {
      case "insert":
        return opInsert(doc, op, i, st);
      case "update":
        return opUpdate(doc, op, i, st);
      case "delete":
        return opDelete(doc, op, i, st);
      case "move":
        return opMove(doc, op, i, st);
      case "replace_text":
        return opReplaceText(doc, op, i, st);
      case "replace_all":
        return opReplaceAll(doc, op, i, st);
      case "insert_row":
        return opInsertRow(doc, op, i, st);
      case "delete_row":
        return opDeleteRow(doc, op, i, st);
      case "set_cell":
        return opSetCell(doc, op, i, st);
      default:
        throw invalid(i, `Unknown op "${String((op as { op?: unknown }).op)}"`);
    }
  });
  fillEmptyGroups(doc);
  return st;
}

function liveRange(doc: Y.Doc, spans: Span[]): TextRange | null {
  for (let k = spans.length - 1; k >= 0; k--) {
    const start = resolvePoint(doc, spans[k]!.start);
    const end = resolvePoint(doc, spans[k]!.end);
    if (!start || !end) continue;
    return {
      start: Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(start[0], start[1])),
      end: Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(end[0], end[1], -1)),
    };
  }
  return null;
}

function rehearse(doc: Y.Doc, ops: DocOp[]): DocOp[] {
  if (!Array.isArray(ops) || ops.length === 0) {
    throw new DocEditError("INVALID_OP", "ops must be a non-empty array");
  }
  const replaceAllAt = ops.findIndex((op) => op?.op === "replace_all");
  if (replaceAllAt !== -1 && ops.length > 1) {
    throw invalid(replaceAllAt, "replace_all must be the only op in a call");
  }
  if (isLegacy(doc)) throw new DocEditError("LEGACY_DOC", LEGACY_MESSAGE);

  const resolved = structuredClone(ops);
  const rehearsal = new Y.Doc();
  try {
    Y.applyUpdate(rehearsal, Y.encodeStateAsUpdate(doc));
    runOps(rehearsal, resolved, true);
  } finally {
    rehearsal.destroy();
  }
  return resolved;
}

export function applyOpsToDoc(doc: Y.Doc, ops: DocOp[]): DocEditResult {
  const resolved = rehearse(doc, ops);
  let st!: RunState;
  doc.transact(() => {
    st = runOps(doc, resolved, false);
  });

  const present = collectIds(topGroup(doc));
  const touched = [...new Set(st.touched)].filter((id) => present.has(id));
  const blockHashes: Record<string, string> = {};
  const treeHashes: Record<string, string> = {};
  for (const id of [...touched, ...st.moved]) {
    const loc = present.has(id) && !(id in blockHashes) ? locate(doc, id) : null;
    if (!loc) continue;
    const current = hashes(decodeElement(loc.el));
    blockHashes[id] = current.hash;
    if (current.treeHash) treeHashes[id] = current.treeHash;
  }
  return {
    touched,
    hashes: blockHashes,
    treeHashes,
    range: liveRange(doc, st.spans),
    results: st.results,
  };
}

function needsUndoPoint(ops: DocOp[]): boolean {
  return ops.some(
    (op) => op?.op === "replace_all" || op?.op === "delete" || (op?.op === "update" && op.children !== undefined),
  );
}

export function applyDocOps(
  docName: string,
  ops: DocOp[],
  authorId: string,
  options: { onApplied?: (result: DocEditResult) => void } = {},
): Promise<DocEditResult> {
  return transactCollabDoc(docName, authorId, (doc) => applyOpsToDoc(doc, ops), {
    afterLiveChange: options.onApplied,
    prepare: needsUndoPoint(ops)
      ? async (doc) => {
          rehearse(doc, ops);
          await saveVersion(docName, doc, UNDO_LABEL, [authorId]);
        }
      : undefined,
  });
}
