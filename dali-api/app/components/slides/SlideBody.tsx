import { Fragment, type ReactNode } from "react";
import { cn } from "~/lib/cn";
import type { RichDoc } from "~/components/slides/types";
import type { CSSProperties } from "react";

// Slides only need a small, fixed slice of BlockNote. Rendering it directly
// keeps thumbnails cheap (no editor instance per slide) and never touches raw HTML.

type Styles = { bold?: boolean; italic?: boolean; underline?: boolean; strike?: boolean; code?: boolean };
type Inline =
  | { type: "text"; text: string; styles?: Styles }
  | { type: "link"; href: string; content?: Inline[] | string };
type TableCell = Inline[] | { content?: Inline[] | string };
type TableData = { headerRows?: number; rows?: Array<{ cells?: TableCell[] }> };
type Block = {
  id?: string;
  type?: string;
  props?: Record<string, unknown>;
  content?: Inline[] | string | TableData;
  children?: Block[];
};

const LIST_TYPES = new Set(["bulletListItem", "numberedListItem", "checkListItem"]);

/** Classes for the fixed 960 by 540 legacy canvas, or colour-free ones for a themed deck whose colours come from `--slide-*`. */
interface Look {
  code: string;
  codeStyle?: CSSProperties;
  strong: string;
  link: string;
  linkStyle?: CSSProperties;
  h: [string, string, string];
  headingStyle?: CSSProperties;
  quote: string;
  quoteStyle?: CSSProperties;
  pre: string;
  preStyle?: CSSProperties;
  image: string;
  rule: string;
  ruleStyle?: CSSProperties;
  box: string;
  boxStyle?: CSSProperties;
  marker: string;
}

const LEGACY_LOOK: Look = {
  code: "rounded-md bg-brand-off px-2 py-0.5 font-mono text-[0.85em] text-navy-deep",
  strong: "font-semibold text-navy-deep",
  link: "text-navy-deep underline",
  h: ["text-[34px]", "text-[30px]", "text-[26px]"],
  headingStyle: undefined,
  quote: "border-l-4 border-accent-coral pl-5 text-brand-charcoal",
  pre: "overflow-hidden rounded-xl bg-navy-deep px-6 py-5 font-mono text-[18px] leading-relaxed text-brand-off",
  image: "max-w-full rounded-xl",
  rule: "border-brand-gray",
  box: "mt-2 inline-block h-5 w-5 shrink-0 rounded border-2 border-accent-teal",
  marker: "marker:text-accent-teal",
};

const THEMED_LOOK: Look = {
  code: "rounded-md px-[0.3em] py-[0.05em] font-mono text-[0.85em]",
  codeStyle: { background: "var(--slide-surface)" },
  strong: "font-bold",
  link: "underline",
  linkStyle: { color: "var(--slide-accent)" },
  h: ["text-[1.4em]", "text-[1.25em]", "text-[1.1em]"],
  headingStyle: { fontFamily: "var(--slide-font-display)", fontWeight: 700 },
  quote: "border-l-[6px] pl-[0.8em]",
  quoteStyle: { borderColor: "var(--slide-accent)", color: "var(--slide-muted)" },
  pre: "overflow-hidden rounded-xl px-[0.8em] py-[0.6em] font-mono text-[0.8em] leading-relaxed",
  preStyle: { background: "var(--slide-surface)", whiteSpace: "pre-wrap", overflowWrap: "anywhere" },
  image: "max-w-full rounded-xl",
  rule: "",
  ruleStyle: { borderColor: "var(--slide-rule)" },
  box: "mt-[0.35em] inline-block h-[0.6em] w-[0.6em] shrink-0 rounded border-2",
  boxStyle: { borderColor: "var(--slide-accent)" },
  marker: "marker:[color:var(--slide-accent)]",
};

function renderText(item: { text: string; styles?: Styles }, key: number, look: Look): ReactNode {
  const s = item.styles ?? {};
  let node: ReactNode = item.text;
  if (s.code) node = <code className={look.code} style={look.codeStyle}>{node}</code>;
  if (s.bold) node = <strong className={look.strong}>{node}</strong>;
  if (s.italic) node = <em>{node}</em>;
  if (s.underline) node = <u>{node}</u>;
  if (s.strike) node = <s>{node}</s>;
  return <Fragment key={key}>{node}</Fragment>;
}

function renderInline(content: Block["content"] | Inline[], look: Look): ReactNode {
  if (content == null) return null;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return null;
  return (content as Inline[]).map((item, i) => {
    if (item?.type === "text") return renderText(item, i, look);
    if (item?.type === "link") {
      const inner = typeof item.content === "string" ? item.content : (item.content ?? []).map((t, j) => (t.type === "text" ? renderText(t, j, look) : null));
      return (
        <a key={i} href={item.href} target="_blank" rel="noreferrer" className={look.link} style={look.linkStyle}>
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
  return (content as Inline[]).map((c) => (c.type === "text" ? c.text : plainText(c.content as Block["content"]))).join("");
}

const cellInline = (cell: TableCell): Inline[] | string | undefined => (Array.isArray(cell) ? cell : cell?.content);

export const TABLE_CELL_BORDER = "var(--slide-rule)";

function renderTable(block: Block, key: string, look: Look): ReactNode {
  const data = block.content as TableData;
  const rows = Array.isArray(data?.rows) ? data.rows : [];
  if (rows.length === 0) return null;
  const headerRows = data.headerRows ?? 0;
  return (
    <table key={key} data-slide-table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed", fontSize: "0.8em" }}>
      <tbody>
        {rows.map((row, r) => (
          <tr key={r}>
            {(row.cells ?? []).map((cell, c) => {
              const header = r < headerRows;
              const Tag = header ? "th" : "td";
              return (
                <Tag
                  key={c}
                  style={{
                    border: `${look === LEGACY_LOOK ? "1px" : "calc(3 * var(--slide-u))"} solid ${TABLE_CELL_BORDER}`,
                    padding: "0.35em 0.6em",
                    textAlign: "left",
                    verticalAlign: "top",
                    fontWeight: header ? 700 : "inherit",
                    background: header ? "var(--slide-surface)" : "transparent",
                  }}
                >
                  {renderInline(cellInline(cell) as Block["content"], look)}
                </Tag>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function renderItem(block: Block, key: string, look: Look): ReactNode {
  const checked = block.type === "checkListItem" && Boolean(block.props?.checked);
  return (
    <li key={key} className={cn("[&+li]:mt-2.5", block.type === "checkListItem" && "flex list-none items-start gap-3")}>
      {block.type === "checkListItem" && (
        <span
          aria-hidden
          className={cn(look.box, checked && !look.boxStyle && "bg-accent-teal")}
          style={{ ...look.boxStyle, ...(checked && look.boxStyle ? { background: "var(--slide-accent)" } : {}) }}
        />
      )}
      <span className={cn(checked && "line-through opacity-60")}>{renderInline(block.content, look)}</span>
      {block.children?.length ? <div className="mt-2.5">{renderBlocks(block.children, look)}</div> : null}
    </li>
  );
}

function renderBlock(block: Block, key: string, look: Look): ReactNode {
  const children = block.children?.length ? <div className="pl-6">{renderBlocks(block.children, look)}</div> : null;
  switch (block.type) {
    case "paragraph":
      return (
        <Fragment key={key}>
          <p>{renderInline(block.content, look)}</p>
          {children}
        </Fragment>
      );
    case "heading": {
      const level = Number(block.props?.level ?? 1);
      const cls = look.h[Math.min(Math.max(level, 1), 3) - 1];
      const Tag = (level === 1 ? "h3" : level === 2 ? "h4" : "h5") as "h3";
      return (
        <Fragment key={key}>
          <Tag className={cn(cls, look === LEGACY_LOOK && "font-semibold text-navy-deep")} style={look.headingStyle}>{renderInline(block.content, look)}</Tag>
          {children}
        </Fragment>
      );
    }
    case "quote":
      return (
        <blockquote key={key} className={look.quote} style={look.quoteStyle}>
          {renderInline(block.content, look)}
        </blockquote>
      );
    case "codeBlock":
      return (
        <pre key={key} className={look.pre} style={look.preStyle}>
          <code>{plainText(block.content)}</code>
        </pre>
      );
    case "table":
      return renderTable(block, key, look);
    case "image": {
      const url = typeof block.props?.url === "string" ? block.props.url : "";
      if (!url) return null;
      const caption = typeof block.props?.caption === "string" ? block.props.caption : "";
      return <img key={key} src={url} alt={caption} className={look.image} />;
    }
    case "divider":
      return <hr key={key} className={look.rule} style={look.ruleStyle} />;
    default:
      return null;
  }
}

function renderBlocks(blocks: Block[], look: Look): ReactNode[] {
  const out: ReactNode[] = [];
  let i = 0;
  while (i < blocks.length) {
    const block = blocks[i];
    const type = block?.type ?? "";
    if (LIST_TYPES.has(type)) {
      const group: Block[] = [];
      while (i < blocks.length && blocks[i]?.type === type) group.push(blocks[i++]);
      const key = `${type}-${group[0].id ?? i}`;
      const items = group.map((b, j) => renderItem(b, b.id ?? `${key}-${j}`, look));
      out.push(
        type === "numberedListItem" ? (
          <ol key={key} className={cn("list-decimal pl-[1.2em]", look.marker)}>
            {items}
          </ol>
        ) : (
          <ul key={key} className={cn("pl-[1.2em]", look.marker, type === "bulletListItem" ? "list-disc" : "list-none pl-0")}>
            {items}
          </ul>
        ),
      );
      continue;
    }
    out.push(renderBlock(block, block?.id ?? `b-${i}`, look));
    i++;
  }
  return out;
}

/** A slide's rich body. Legacy decks draw it for the 960 by 540 canvas; `themed` draws it in the surrounding em with `--slide-*` colours. */
export function SlideBody({ doc, className, themed = false }: { doc: RichDoc | undefined; className?: string; themed?: boolean }) {
  if (!Array.isArray(doc) || doc.length === 0) return null;
  const look = themed ? THEMED_LOOK : LEGACY_LOOK;
  return (
    <div className={cn(themed ? "space-y-[0.5em]" : "space-y-3.5 text-[24px] leading-normal text-navy-deep/90", className)}>
      {renderBlocks(doc as unknown as Block[], look)}
    </div>
  );
}
