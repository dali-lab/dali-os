import type { DocBlock, DocInline, DocTableCell, DocTableContent } from "./blocknote-server";

export type InlineRefType = "mention" | "pageMention" | "taskMention";

export interface InlineRefs {
  userIds: string[];
  pageIds: string[];
  taskIds: string[];
}

export interface KnownInlineRefs {
  userIds: Set<string>;
  pageIds: Set<string>;
  taskIds: Set<string>;
  userLabels?: Map<string, string>;
  taskProjects?: Map<string, string>;
}

export interface DowngradedInlineRef {
  type: InlineRefType;
  id: string;
  label: string;
  reason?: "projectMismatch";
}

export type InlineArrayKind = "block" | "cell";

function isTableContent(content: DocBlock["content"]): content is DocTableContent {
  return !!content && typeof content === "object" && !Array.isArray(content) && Array.isArray(content.rows);
}

export function mapInlineArrays(
  blocks: DocBlock[],
  fn: (inlines: DocInline[], kind: InlineArrayKind) => DocInline[],
): DocBlock[] {
  return blocks.map((block) => {
    const content = block.content;
    let mapped: Partial<DocBlock> = {};
    if (Array.isArray(content)) {
      mapped = { content: fn(content, "block") };
    } else if (isTableContent(content)) {
      mapped = {
        content: {
          ...content,
          rows: content.rows.map((row) => ({
            ...row,
            cells: row.cells.map((cell): DocTableCell | DocInline[] =>
              Array.isArray(cell)
                ? fn(cell, "cell")
                : { ...cell, content: fn(cell.content ?? [], "cell") },
            ),
          })),
        },
      };
    }
    return { ...block, ...mapped, children: mapInlineArrays(block.children ?? [], fn) };
  });
}

function refOf(inline: DocInline): DowngradedInlineRef | null {
  const props = inline.props ?? {};
  const label = typeof props.label === "string" ? props.label : "";
  const str = (value: unknown) => (typeof value === "string" ? value : "");
  if (inline.type === "mention") return { type: "mention", id: str(props.id), label };
  if (inline.type === "pageMention") return { type: "pageMention", id: str(props.pageId), label };
  if (inline.type === "taskMention") return { type: "taskMention", id: str(props.taskId), label };
  return null;
}

export function collectInlineRefs(blocks: DocBlock[]): InlineRefs {
  const found = { mention: new Set<string>(), pageMention: new Set<string>(), taskMention: new Set<string>() };
  const visit = (inlines: DocInline[]) => {
    for (const inline of inlines) {
      const ref = refOf(inline);
      if (ref?.id) found[ref.type].add(ref.id);
      if (Array.isArray(inline.content)) visit(inline.content);
    }
  };
  mapInlineArrays(blocks, (inlines) => {
    visit(inlines);
    return inlines;
  });
  return {
    userIds: [...found.mention],
    pageIds: [...found.pageMention],
    taskIds: [...found.taskMention],
  };
}

export function downgradeInlineRefs(
  blocks: DocBlock[],
  known: KnownInlineRefs,
): { blocks: DocBlock[]; downgraded: DowngradedInlineRef[] } {
  const downgraded: DowngradedInlineRef[] = [];
  const knownFor: Record<InlineRefType, Set<string>> = {
    mention: known.userIds,
    pageMention: known.pageIds,
    taskMention: known.taskIds,
  };
  const downgrade = (ref: DowngradedInlineRef): DocInline[] => {
    downgraded.push(ref);
    const text = ref.type === "mention" ? `@${ref.label}` : ref.label;
    return text ? [{ type: "text", text, styles: {} }] : [];
  };
  const next = mapInlineArrays(blocks, (inlines) =>
    inlines.flatMap((inline): DocInline[] => {
      const ref = refOf(inline);
      if (!ref) return [inline];
      if (!knownFor[ref.type].has(ref.id)) return downgrade(ref);
      const projectId = ref.type === "taskMention" ? known.taskProjects?.get(ref.id) : undefined;
      if (projectId !== undefined && projectId !== inline.props?.projectId) {
        return downgrade({ ...ref, reason: "projectMismatch" });
      }
      const label = ref.type === "mention" ? known.userLabels?.get(ref.id) : undefined;
      return [label === undefined ? inline : { ...inline, props: { ...inline.props, label } }];
    }),
  );
  return { blocks: next, downgraded };
}

const ID = "([A-Za-z0-9_-]+)";
const MEMBER_HREF = new RegExp(`^/members/${ID}$`);
const PAGE_HREF = new RegExp(`^/documents/${ID}$`);
const TASK_HREF = new RegExp(`^/projects/${ID}\\?tab=progress&task=${ID}$`);

function linkToRef(inline: DocInline): DocInline | null {
  if (inline.type !== "link" || !inline.href || inline.content?.length !== 1) return null;
  const [run] = inline.content;
  if (run!.type !== "text" || typeof run!.text !== "string") return null;
  if (Object.keys(run!.styles ?? {}).length > 0) return null;
  const text = run!.text.replaceAll("\\<", "<");
  const member = MEMBER_HREF.exec(inline.href);
  if (member && text.startsWith("@")) {
    return { type: "mention", props: { id: member[1], label: text.slice(1) } };
  }
  const page = PAGE_HREF.exec(inline.href);
  if (page) return { type: "pageMention", props: { pageId: page[1], label: text } };
  const task = TASK_HREF.exec(inline.href);
  if (task) return { type: "taskMention", props: { taskId: task[2], projectId: task[1], label: text } };
  return null;
}

export function linksToInlineRefs(blocks: DocBlock[]): DocBlock[] {
  return mapInlineArrays(blocks, (inlines) => inlines.map((inline) => linkToRef(inline) ?? inline));
}
