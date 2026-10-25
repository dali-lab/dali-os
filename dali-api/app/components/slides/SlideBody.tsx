import { Fragment, type ReactNode } from "react";
import { cn } from "~/lib/cn";
import type { RichDoc } from "~/components/slides/types";

// Slides only need a small, fixed slice of BlockNote. Rendering it directly
// keeps thumbnails cheap (no editor instance per slide) and never touches raw HTML.

type Styles = { bold?: boolean; italic?: boolean; underline?: boolean; strike?: boolean; code?: boolean };
type Inline =
  | { type: "text"; text: string; styles?: Styles }
  | { type: "link"; href: string; content?: Inline[] | string };
type Block = {
  id?: string;
  type?: string;
  props?: Record<string, unknown>;
  content?: Inline[] | string;
  children?: Block[];
};

const LIST_TYPES = new Set(["bulletListItem", "numberedListItem", "checkListItem"]);

function renderText(item: { text: string; styles?: Styles }, key: number): ReactNode {
  const s = item.styles ?? {};
  let node: ReactNode = item.text;
  if (s.code) node = <code className="rounded-md bg-brand-off px-2 py-0.5 font-mono text-[0.85em] text-navy-deep">{node}</code>;
  if (s.bold) node = <strong className="font-semibold text-navy-deep">{node}</strong>;
  if (s.italic) node = <em>{node}</em>;
  if (s.underline) node = <u>{node}</u>;
  if (s.strike) node = <s>{node}</s>;
  return <Fragment key={key}>{node}</Fragment>;
}

function renderInline(content: Block["content"]): ReactNode {
  if (content == null) return null;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return null;
  return content.map((item, i) => {
    if (item?.type === "text") return renderText(item, i);
    if (item?.type === "link") {
      const inner = typeof item.content === "string" ? item.content : (item.content ?? []).map((t, j) => (t.type === "text" ? renderText(t, j) : null));
      return (
        <a key={i} href={item.href} target="_blank" rel="noreferrer" className="text-navy-deep underline">
          {inner}
        </a>
      );
    }
    return null;
  });
}

function plainText(content: Block["content"]): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((c) => (c.type === "text" ? c.text : plainText(c.content as Block["content"]))).join("");
}

function renderItem(block: Block, key: string): ReactNode {
  const checked = block.type === "checkListItem" && Boolean(block.props?.checked);
  return (
    <li key={key} className={cn("[&+li]:mt-2.5", block.type === "checkListItem" && "flex list-none items-start gap-3")}>
      {block.type === "checkListItem" && (
        <span
          aria-hidden
          className={cn("mt-2 inline-block h-5 w-5 shrink-0 rounded border-2 border-accent-teal", checked && "bg-accent-teal")}
        />
      )}
      <span className={cn(checked && "line-through opacity-60")}>{renderInline(block.content)}</span>
      {block.children?.length ? <div className="mt-2.5">{renderBlocks(block.children)}</div> : null}
    </li>
  );
}

function renderBlock(block: Block, key: string): ReactNode {
  const children = block.children?.length ? <div className="pl-6">{renderBlocks(block.children)}</div> : null;
  switch (block.type) {
    case "paragraph":
      return (
        <Fragment key={key}>
          <p>{renderInline(block.content)}</p>
          {children}
        </Fragment>
      );
    case "heading": {
      const level = Number(block.props?.level ?? 1);
      const cls = level === 1 ? "text-[34px]" : level === 2 ? "text-[30px]" : "text-[26px]";
      const Tag = (level === 1 ? "h3" : level === 2 ? "h4" : "h5") as "h3";
      return (
        <Fragment key={key}>
          <Tag className={cn(cls, "font-semibold text-navy-deep")}>{renderInline(block.content)}</Tag>
          {children}
        </Fragment>
      );
    }
    case "quote":
      return (
        <blockquote key={key} className="border-l-4 border-accent-coral pl-5 text-brand-charcoal">
          {renderInline(block.content)}
        </blockquote>
      );
    case "codeBlock":
      return (
        <pre key={key} className="overflow-hidden rounded-xl bg-navy-deep px-6 py-5 font-mono text-[18px] leading-relaxed text-brand-off">
          <code>{plainText(block.content)}</code>
        </pre>
      );
    case "image": {
      const url = typeof block.props?.url === "string" ? block.props.url : "";
      if (!url) return null;
      const caption = typeof block.props?.caption === "string" ? block.props.caption : "";
      return <img key={key} src={url} alt={caption} className="max-w-full rounded-xl" />;
    }
    case "divider":
      return <hr key={key} className="border-brand-gray" />;
    default:
      return null;
  }
}

function renderBlocks(blocks: Block[]): ReactNode[] {
  const out: ReactNode[] = [];
  let i = 0;
  while (i < blocks.length) {
    const block = blocks[i];
    const type = block?.type ?? "";
    if (LIST_TYPES.has(type)) {
      const group: Block[] = [];
      while (i < blocks.length && blocks[i]?.type === type) group.push(blocks[i++]);
      const key = `${type}-${group[0].id ?? i}`;
      const items = group.map((b, j) => renderItem(b, b.id ?? `${key}-${j}`));
      out.push(
        type === "numberedListItem" ? (
          <ol key={key} className="list-decimal pl-[1.2em] marker:text-accent-teal">
            {items}
          </ol>
        ) : (
          <ul key={key} className={cn("pl-[1.2em] marker:text-accent-teal", type === "bulletListItem" ? "list-disc" : "list-none pl-0")}>
            {items}
          </ul>
        ),
      );
      continue;
    }
    out.push(renderBlock(block, block?.id ?? `b-${i}`));
    i++;
  }
  return out;
}

/** A slide's rich body, styled for the fixed 960×540 slide canvas. */
export function SlideBody({ doc, className }: { doc: RichDoc | undefined; className?: string }) {
  if (!Array.isArray(doc) || doc.length === 0) return null;
  return (
    <div className={cn("space-y-3.5 text-[24px] leading-normal text-navy-deep/90", className)}>
      {renderBlocks(doc as unknown as Block[])}
    </div>
  );
}
