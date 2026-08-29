// Server-side BlockNote codec: the ONE place the server builds a BlockNote
// schema and talks to @blocknote/server-util. Every server read/write of a
// collaborative document flows through the helpers here.
//
// The schema wraps the SAME shared config objects the client editor uses
// (app/components/doc/schema/configs.ts) with the CORE (non-React) spec
// factories — React specs crash dev-mode React on the server (async teardown
// reads window.event after jsdom is gone; proven in the migration spike).
//
// Block JSON ("DocBlock") is the canonical document shape on the server:
// stored in source columns by sync-back, returned by readDocAsBlocks, consumed
// by every exporter.

import {
  BlockNoteSchema,
  createBlockSpec,
  createInlineContentSpec,
  createPageBreakBlockSpec,
  defaultBlockSpecs,
  defaultInlineContentSpecs,
  defaultStyleSpecs,
} from "@blocknote/core";
import { ServerBlockNoteEditor } from "@blocknote/server-util";
import { randomUUID } from "node:crypto";
import type * as Y from "yjs";
import {
  calloutConfig,
  embedConfig,
  mentionConfig,
  pageMentionConfig,
  signingFieldConfigs,
  variableConfig,
} from "~/components/doc/schema/configs";
import {
  fieldCaption,
  fieldDisplayText,
  variableDisplayText,
  type SigningFieldType,
} from "~/lib/signing-fields";
import { sanitizeRichEmailHtml, htmlToPlainText } from "~/lib/email";

export { BLOCKNOTE_FRAGMENT, LEGACY_PM_FRAGMENT } from "~/components/doc/schema/configs";

// ---------------------------------------------------------------------------
// Loose structural block types. Deliberately not the @blocknote/core generics:
// block JSON crosses JSON columns, MCP payloads, and the conversion mapper,
// none of which can carry the schema's type parameters. The server-util
// boundary casts.

export interface DocInline {
  type: string;
  text?: string;
  styles?: Record<string, unknown>;
  href?: string;
  content?: DocInline[];
  props?: Record<string, unknown>;
}

export interface DocTableCell {
  type: "tableCell";
  props?: Record<string, unknown>;
  content: DocInline[];
}

export interface DocTableContent {
  type: "tableContent";
  columnWidths?: (number | null | undefined)[];
  headerRows?: number;
  headerCols?: number;
  // Cells may be full tableCell objects (Y round-trip normal form) or bare
  // inline arrays (partial form) — walkers must accept both.
  rows: { cells: (DocTableCell | DocInline[])[] }[];
}

export interface DocBlock {
  id: string;
  type: string;
  props: Record<string, unknown>;
  content?: DocInline[] | DocTableContent | string;
  children: DocBlock[];
}

// ---------------------------------------------------------------------------
// Core (non-React) specs over the shared configs. Renders are used by the
// HTML/Markdown serializers: markdown takes each node's textContent, so these
// double as the plain-text form of every custom node.

const mentionSpec = createInlineContentSpec(mentionConfig, {
  render: (ic) => {
    const dom = document.createElement("span");
    dom.setAttribute("data-mention-id", ic.props.id);
    dom.textContent = `@${ic.props.label}`;
    return { dom };
  },
});

const pageMentionSpec = createInlineContentSpec(pageMentionConfig, {
  render: (ic) => {
    const dom = document.createElement("span");
    dom.setAttribute("data-page-mention-id", ic.props.pageId);
    dom.textContent = ic.props.label || "Untitled";
    return { dom };
  },
});

const signingFieldSpecs = Object.fromEntries(
  signingFieldConfigs.map((config) => [
    config.type,
    createInlineContentSpec(config, {
      render: (ic) => {
        const dom = document.createElement("span");
        const type = config.type as SigningFieldType;
        const label = typeof ic.props.label === "string" ? ic.props.label.trim() : "";
        const text = fieldDisplayText(type, ic.props.value);
        // Checkbox: glyph + its label. Non-checkbox: the captured value, else a
        // signature line captioned with the field's kind ("(Signature)", …).
        dom.textContent =
          type === "checkboxField"
            ? label
              ? `${text} ${label}`
              : text
            : text || `__________ (${fieldCaption(type, label)})`;
        return { dom };
      },
    }),
  ]),
);

const variableSpec = createInlineContentSpec(variableConfig, {
  render: (ic) => {
    const dom = document.createElement("span");
    dom.textContent = variableDisplayText(ic.props.name, ic.props.value);
    return { dom };
  },
});

const calloutSpec = createBlockSpec(calloutConfig, {
  render: (block) => {
    const dom = document.createElement("div");
    dom.setAttribute("data-callout", "");
    const emoji = document.createElement("span");
    emoji.textContent = String(block.props.emoji ?? "");
    dom.appendChild(emoji);
    const contentDOM = document.createElement("div");
    dom.appendChild(contentDOM);
    return { dom, contentDOM };
  },
})();

// Bookmark/embed: renders as an anchor card so export / version-history HTML
// keeps the link (content: "none" — no contentDOM).
const embedSpec = createBlockSpec(embedConfig, {
  render: (block) => {
    const url = String(block.props.url ?? "");
    const title = String(block.props.title ?? "");
    const dom = document.createElement("a");
    dom.setAttribute("data-embed", "");
    if (url) {
      dom.setAttribute("href", url);
      dom.setAttribute("target", "_blank");
      dom.setAttribute("rel", "noopener noreferrer");
    }
    let label = title;
    if (!label && url) {
      try {
        label = new URL(url).hostname.replace(/^www\./, "");
      } catch {
        label = url;
      }
    }
    dom.textContent = label || url;
    return { dom };
  },
})();

// defaultBlockSpecs includes file and video (and audio, which the app never
// uses but keeping it in the server schema is harmless — it ensures blocks
// authored by external tools are preserved, not stripped on server read).
export const serverSchema = BlockNoteSchema.create({
  blockSpecs: { ...defaultBlockSpecs, callout: calloutSpec, embed: embedSpec, pageBreak: createPageBreakBlockSpec() },
  inlineContentSpecs: {
    ...defaultInlineContentSpecs,
    mention: mentionSpec,
    pageMention: pageMentionSpec,
    ...signingFieldSpecs,
    variable: variableSpec,
  },
  styleSpecs: { ...defaultStyleSpecs },
});

// ---------------------------------------------------------------------------
// Singleton editor + a serialization lock. The async conversions install a
// jsdom window on globalThis for their duration (_withJSDOM); two interleaved
// conversions would tear each other's globals down, so they queue.

let editorSingleton: ServerBlockNoteEditor<any, any, any> | null = null;

export function getServerEditor(): ServerBlockNoteEditor<any, any, any> {
  if (!editorSingleton) {
    editorSingleton = ServerBlockNoteEditor.create({ schema: serverSchema as any });
  }
  return editorSingleton;
}

let conversionChain: Promise<unknown> = Promise.resolve();

function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const next = conversionChain.then(fn, fn);
  conversionChain = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

// ---------------------------------------------------------------------------
// Conversions

/** Blocks → simplified semantic HTML (blocksToHTMLLossy — the right dialect
 * for docx export, education description panes, and the public site). */
export function blocksToHtml(blocks: DocBlock[]): Promise<string> {
  if (blocks.length === 0) return Promise.resolve("");
  return serialized(() => getServerEditor().blocksToHTMLLossy(blocks as any));
}

/** Blocks → the FULL BlockNote editor DOM (blocksToFullHTML), carrying the
 * editor's `bn-*` classes + data attributes. Paired with @blocknote/core's
 * stylesheet this renders like the on-screen editor — the dialect the PDF
 * exporter feeds to headless Chromium. */
export function blocksToFullHtml(blocks: DocBlock[]): Promise<string> {
  if (blocks.length === 0) return Promise.resolve("");
  return serialized(() => getServerEditor().blocksToFullHTML(blocks as any));
}

/** Announcement body → { html, text }: email-safe sanitized HTML for the email
 * channel plus a plain-text mirror for the in-app feed and Slack DM. One
 * conversion, shared by instant and scheduled sends. */
export async function renderAnnouncementBody(
  blocks: DocBlock[],
): Promise<{ html: string; text: string }> {
  const html = sanitizeRichEmailHtml(await blocksToHtml(blocks));
  return { html, text: htmlToPlainText(html) };
}

/** Blocks → Markdown. Custom inline nodes serialize as their plain-text form
 * (mention → "@handle", unfilled field → "__________", variable → value or
 * "{{name}}"). */
export function blocksToMarkdown(blocks: DocBlock[]): Promise<string> {
  if (blocks.length === 0) return Promise.resolve("");
  return serialized(() => getServerEditor().blocksToMarkdownLossy(blocks as any));
}

/** Markdown → blocks. Empty/whitespace input yields a single empty paragraph
 * (BlockNote's empty-document normal form). */
export function markdownToBlocks(markdown: string): Promise<DocBlock[]> {
  return serialized(async () => {
    const blocks = await getServerEditor().tryParseMarkdownToBlocks(markdown);
    return blocks as unknown as DocBlock[];
  });
}

/** Write blocks into a Y.XmlFragment. REPLACE semantics: server-util diffs the
 * fragment to match the given blocks (verified against 0.52.1), so this is
 * safe on both fresh and already-populated fragments. Callers must run inside
 * the owning doc's transaction context where one exists. */
export function blocksToFragment(blocks: DocBlock[], fragment: Y.XmlFragment): void {
  getServerEditor().blocksToYXmlFragment(blocks as any, fragment);
}

/** Read a Y.XmlFragment as blocks. Empty fragment → []. */
export function fragmentToBlocks(fragment: Y.XmlFragment): DocBlock[] {
  if (fragment.length === 0) return [];
  return getServerEditor().yXmlFragmentToBlocks(fragment) as unknown as DocBlock[];
}

/** One paragraph block per line of plain text — the seed shape for rooms whose
 * source column is a plain-text field (hiring reviews, prep notes). */
export function plainTextToBlocks(text: string): DocBlock[] {
  return text.split("\n").map((line) => ({
    id: randomUUID(),
    type: "paragraph",
    props: { backgroundColor: "default", textColor: "default", textAlignment: "left" },
    content: line ? [{ type: "text", text: line, styles: {} }] : [],
    children: [],
  }));
}
