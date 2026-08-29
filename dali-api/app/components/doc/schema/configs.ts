// Shared BlockNote schema CONFIG objects — the single source of truth for the
// app's custom node types. Pure data: no React, no editor imports, safe on
// both client and server.
//
// The client editor wraps these with createReactInlineContentSpec /
// createReactBlockSpec (@blocknote/react); server codecs wrap the SAME configs
// with the core (non-React) factories createInlineContentSpec /
// createBlockSpec (@blocknote/core) — React specs crash dev-mode React on the
// server (async teardown reads window.event after jsdom is torn down; see the
// spike's server-util findings). Sharing the config object keeps the two spec
// families schema-identical, so documents are interchangeable.
//
// Prop shapes preserve the legacy TipTap attrs 1:1 (`attrs.{...}` →
// `props.{...}`, same keys and value types) — the PM→BlockNote conversion
// mapper and the mention-notification scanner both depend on this.

// Y.Doc fragment names. BlockNote binds "blocknote"; the legacy Tiptap editor
// bound "default" (ProseMirror XML). Both fragments live in the SAME Y.Doc —
// lazy conversion reads "default" and writes "blocknote", never the reverse.
export const BLOCKNOTE_FRAGMENT = "blocknote";
export const LEGACY_PM_FRAGMENT = "default";

// Page break: no props, no content — a pure structural separator.
export const pageBreakConfig = {
  type: "pageBreak" as const,
  propSchema: {} as const,
  content: "none" as const,
};

export const mentionConfig = {
  type: "mention",
  propSchema: {
    id: { default: "" }, // user id (UUID)
    label: { default: "" }, // user handle
  },
  content: "none",
} as const;

// Page-mention inline node: links to another Page by id + a snapshot of its
// title at insert time. Separate from `mention` (user mention) so the server
// walkers can distinguish them without inspecting props — existing persisted
// docs that carry "mention" nodes (user mentions) are unaffected because they
// use a different node type string. `pageId` and `label` default to "" so old
// docs that predate this node type render without crashing.
export const pageMentionConfig = {
  type: "pageMention",
  propSchema: {
    pageId: { default: "" }, // Page.id
    label: { default: "" },  // snapshot of Page.title at insert time
  },
  content: "none",
} as const;

// Callout: colored container with an emoji icon. Representation decision from
// the spike (Phase 0, item 6): content is INLINE; additional paragraphs live
// as nested children, painted into the box via CSS on the child blockGroup
// (BlockNote's own toggle-block house pattern).
export const calloutConfig = {
  type: "callout",
  propSchema: {
    emoji: { default: "💡" },
  },
  content: "inline",
} as const;

// Bookmark/embed: a block-level link card. `url` is the target; `title` is an
// optional user-supplied caption (defaults to "", in which case the card shows
// the domain). content: "none" — the card is not editable inline. Old docs
// predate this type and are unaffected (distinct type string).
export const embedConfig = {
  type: "embed",
  propSchema: {
    url: { default: "" },
    title: { default: "" },
  },
  content: "none",
} as const;

// Signing field family — one inline-content type per legacy TipTap node type
// (signatureField/dateField/initialField/checkboxField/textField), preserving
// the node-type↔field-type mapping the conversion mapper and the server-side
// collectSigningFields/bakeSigningBody walkers rely on. `value` carries the
// baked value in frozen snapshots; live fill values stay in host React state
// keyed by fieldId (never in the document).
export const signingFieldPropSchema = {
  fieldId: { default: "" },
  role: { default: "" },
  label: { default: "" },
  placeholder: { default: "" },
  value: { default: "" },
  required: { default: false },
  // Only the pre-signed adminSignatureField uses this: the configured
  // signatory's user id, resolved to a supervisor audit signature at issuance.
  signerUserId: { default: "" },
} as const;

export const SIGNING_FIELD_TYPES = [
  "signatureField",
  "dateField",
  "initialField",
  "checkboxField",
  "textField",
  // Pre-signed staff counter-signature: bound to a configured signatory in the
  // builder, always read-only (never filled by the member signer).
  "adminSignatureField",
] as const;
export type SigningFieldType = (typeof SIGNING_FIELD_TYPES)[number];

export const signingFieldConfigs = SIGNING_FIELD_TYPES.map((type) => ({
  type,
  propSchema: signingFieldPropSchema,
  content: "none" as const,
}));

// Merge variable ({{term}}): `name` is the variable key, `value` the baked
// resolution (frozen snapshots) — null-equivalent is "".
export const variableConfig = {
  type: "variable",
  propSchema: {
    name: { default: "" },
    value: { default: "" },
  },
  content: "none",
} as const;

// ---------------------------------------------------------------------------

// Minimal structural walk shared by server codecs (plaintext mirrors, search,
// notification previews). Deliberately structurally-typed: accepts any block
// tree shaped like BlockNote's Block JSON without importing editor types.
interface AnyInline {
  type?: string;
  text?: string;
  content?: AnyInline[] | string;
  props?: Record<string, unknown>;
}
interface AnyBlock {
  type?: string;
  props?: Record<string, unknown>;
  content?:
    | AnyInline[]
    | { rows?: { cells?: (AnyInline[] | { content?: AnyInline[] })[] }[] }
    | string;
  children?: AnyBlock[];
}

function inlineText(inline: AnyInline): string {
  if (typeof inline.text === "string") return inline.text;
  if (inline.type === "mention") return `@${String(inline.props?.label ?? "")}`;
  if (inline.type === "pageMention") return String(inline.props?.label ?? "");
  if (inline.type === "link" && Array.isArray(inline.content)) {
    return inline.content.map(inlineText).join("");
  }
  return "";
}

// Accepts any array (typed Block[] from any feature schema included) — the
// walk itself is structural, so the parameter shouldn't force callers through
// a cast narrower than what the function actually tolerates.
export function blocksToPlainText(blocks: readonly unknown[] | undefined | null): string {
  if (!Array.isArray(blocks)) return "";
  const lines: string[] = [];
  const walk = (block: AnyBlock) => {
    let line = "";
    const content = block.content;
    if (Array.isArray(content)) {
      line = content.map(inlineText).join("");
    } else if (content && typeof content === "object" && Array.isArray(content.rows)) {
      // table content: rows of cells
      line = content.rows
        .map((row) =>
          (row.cells ?? [])
            .map((cell) =>
              Array.isArray(cell)
                ? cell.map(inlineText).join("")
                : ((cell as { content?: AnyInline[] }).content ?? []).map(inlineText).join(""),
            )
            .join(" "),
        )
        .join("\n");
    } else if (block.type === "file" || block.type === "video") {
      // File and video blocks carry their display name + URL in props, not
      // inline content. Emit "name (url)" matching the image caption convention
      // so search indexers and notification previews surface meaningful text.
      const name = typeof block.props?.name === "string" ? block.props.name : "";
      const url = typeof block.props?.url === "string" ? block.props.url : "";
      const caption = typeof block.props?.caption === "string" ? block.props.caption : "";
      const label = caption || name;
      line = label && url ? `${label} (${url})` : label || url;
    }
    if (line.trim()) lines.push(line);
    for (const child of block.children ?? []) walk(child);
  };
  for (const block of blocks as AnyBlock[]) walk(block);
  return lines.join("\n");
}
