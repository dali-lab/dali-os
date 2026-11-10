import type { ImportBlock, ImportInline } from "./import-types";

const ENTITIES: Record<string, string> = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decode(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, name: string) => {
    if (name[0] === "#") {
      const code = name[1].toLowerCase() === "x" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[name.toLowerCase()] ?? whole;
  });
}

const TOKEN = /<(\/?)([a-z0-9]+)([^>]*)>|([^<]+)/gi;

interface Marks {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  href: string | null;
}

const NO_MARKS: Marks = { bold: false, italic: false, underline: false, strike: false, href: null };

function styleOf(attrs: string): string {
  return /style="([^"]*)"/i.exec(attrs)?.[1] ?? "";
}

function marksFromStyle(style: string, base: Marks): Marks {
  const bold = /font-weight:\s*(bold|[6-9]00)/i.test(style);
  return {
    ...base,
    bold: base.bold || bold,
    italic: base.italic || /font-style:\s*italic/i.test(style),
    underline: base.underline || /text-decoration(?:-line)?:[^;]*underline/i.test(style),
    strike: base.strike || /text-decoration(?:-line)?:[^;]*line-through/i.test(style),
  };
}

function inlineOf(text: string, marks: Marks): ImportInline {
  const styles: Record<string, boolean> = {};
  if (marks.bold) styles.bold = true;
  if (marks.italic) styles.italic = true;
  if (marks.underline) styles.underline = true;
  if (marks.strike) styles.strike = true;
  const run: ImportInline = { type: "text", text, styles };
  return marks.href ? { type: "link", href: marks.href, content: [run] } : run;
}

function pushInline(into: ImportInline[], next: ImportInline): void {
  const last = into[into.length - 1];
  if (last && next.type === "text" && last.type === "text" && JSON.stringify(last.styles) === JSON.stringify(next.styles)) {
    last.text = (last.text ?? "") + (next.text ?? "");
    return;
  }
  into.push(next);
}

const hasText = (content: ImportInline[]): boolean =>
  content.some((c) => (c.type === "text" ? (c.text ?? "").trim() !== "" : hasText(c.content ?? [])));

function trimEnds(content: ImportInline[]): ImportInline[] {
  const first = content[0];
  const last = content[content.length - 1];
  if (first?.type === "text") first.text = (first.text ?? "").replace(/^\s+/, "");
  if (last?.type === "text") last.text = (last.text ?? "").replace(/\s+$/, "");
  return content.filter((c) => c.type !== "text" || (c.text ?? "") !== "");
}

export interface ParsedHtml {
  blocks: ImportBlock[];
  maxFontPt: number;
}

/** The HTML pptxtojson writes for a text body, as blocks. Lists nest by depth; paragraphs with no text are dropped. */
export function parseTextHtml(html: string): ParsedHtml {
  const blocks: ImportBlock[] = [];
  const listStack: Array<"ul" | "ol"> = [];
  const lastAtDepth: ImportBlock[] = [];
  const markStack: Marks[] = [NO_MARKS];
  type Open = { content: ImportInline[]; list: "ul" | "ol" | null; depth: number };
  let current = null as Open | null;
  let maxFontPt = 0;

  const open = (list: "ul" | "ol" | null) => {
    current = { content: [], list, depth: listStack.length };
  };
  const close = () => {
    if (!current) return;
    const content = trimEnds(current.content);
    if (hasText(content)) {
      const block: ImportBlock = {
        type: current.list === "ul" ? "bulletListItem" : current.list === "ol" ? "numberedListItem" : "paragraph",
        content,
        children: [],
      };
      const parent = current.list && current.depth > 1 ? lastAtDepth[current.depth - 1] : undefined;
      if (parent) parent.children.push(block);
      else blocks.push(block);
      if (current.list) lastAtDepth[current.depth] = block;
    }
    current = null;
  };

  TOKEN.lastIndex = 0;
  for (let m = TOKEN.exec(html); m; m = TOKEN.exec(html)) {
    const [, closing, tagRaw, attrs, text] = m;
    if (text !== undefined) {
      const run = decode(text);
      if (!current) open(null);
      pushInline(current!.content, inlineOf(run, markStack[markStack.length - 1]));
      continue;
    }
    const tag = tagRaw.toLowerCase();
    if (closing) {
      if (tag === "p") close();
      else if (tag === "li") close();
      else if (tag === "ul" || tag === "ol") {
        close();
        listStack.pop();
        lastAtDepth.length = Math.min(lastAtDepth.length, listStack.length + 1);
      } else if (tag === "span" || tag === "a") markStack.pop();
      continue;
    }
    if (tag === "ul" || tag === "ol") {
      close();
      listStack.push(tag);
    } else if (tag === "li") {
      close();
      open(listStack[listStack.length - 1] ?? null);
    } else if (tag === "p") {
      if (!current) open(listStack.length ? listStack[listStack.length - 1] : null);
    } else if (tag === "br") {
      if (current) pushInline(current.content, inlineOf(" ", markStack[markStack.length - 1]));
    } else if (tag === "span") {
      const style = styleOf(attrs);
      const size = /font-size:\s*([\d.]+)pt/i.exec(style);
      if (size) maxFontPt = Math.max(maxFontPt, Number(size[1]));
      markStack.push(marksFromStyle(style, markStack[markStack.length - 1]));
    } else if (tag === "a") {
      const href = /href="([^"]*)"/i.exec(attrs)?.[1];
      markStack.push({ ...markStack[markStack.length - 1], href: href ? decode(href) : null });
    }
  }
  close();
  return { blocks, maxFontPt };
}

export function blocksText(blocks: ImportBlock[]): string {
  const inlineText = (content: ImportInline[]): string =>
    content.map((c) => (c.type === "text" ? (c.text ?? "") : inlineText(c.content ?? []))).join("");
  return blocks.map((b) => [inlineText(b.content), blocksText(b.children)].filter(Boolean).join("\n")).join("\n");
}
