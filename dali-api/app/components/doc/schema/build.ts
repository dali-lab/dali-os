// buildSchema(features): the capability→schema mapping — successor of the
// legacy capabilityExtensions() in app/components/editor/presets.ts. One
// resolver for every surface keeps editor↔viewer parity structural: a node
// type enabled on one side can't be forgotten on the other.
//
// Audio is excluded (spec decision: "audio probably never").
// codeBlock is registered through createCodeBlockSpec + @blocknote/code-block's
// shiki bundle, so code blocks get syntax highlighting + a language picker.
//
// TYPE NOTE: the returned schema is always TYPED as the full schema (every
// spec registered) while the runtime instance omits feature-gated specs
// (image without `images`; file/video without `files`;
// table/toggle/callout without `richBlocks`; mention without `mentions`;
// the signing family without `signing`). The static superset keeps one stable
// DocBlock/DocPartialBlock type across the app; the runtime subset is what
// actually validates/strips content.

import {
  BlockNoteSchema,
  createCodeBlockSpec,
  createHeadingBlockSpec,
  createPageBreakBlockSpec,
  defaultBlockSpecs,
  defaultInlineContentSpecs,
} from "@blocknote/core";
import { codeBlockOptions } from "@blocknote/code-block";
import type { Features } from "../features";
import { CalloutSpec } from "./callout";
import { EmbedSpec } from "./embed";
import { MentionSpec, PageMentionSpec } from "./mention";
import { signingInlineSpecs } from "./signing";

// Heading spec with allowToggleHeadings=true enables Notion-style collapsible
// headings (h1–h3 only; h4–h6 are excluded per Notion convention — the app
// caps heading levels at 3, same as Notion, so this is a deliberate decision).
// isToggleable is an optional block prop, so existing documents with plain
// headings are unaffected; the server codec handles the prop transparently
// (it's part of the heading block schema that defaultBlockSpecs.heading already
// registers, just gated behind the option).
const headingSpec = createHeadingBlockSpec({
  levels: [1, 2, 3],
  allowToggleHeadings: true,
});

function fullBlockSpecs() {
  return {
    paragraph: defaultBlockSpecs.paragraph,
    heading: headingSpec,
    quote: defaultBlockSpecs.quote,
    bulletListItem: defaultBlockSpecs.bulletListItem,
    numberedListItem: defaultBlockSpecs.numberedListItem,
    checkListItem: defaultBlockSpecs.checkListItem,
    codeBlock: createCodeBlockSpec(codeBlockOptions),
    divider: defaultBlockSpecs.divider,
    image: defaultBlockSpecs.image,
    file: defaultBlockSpecs.file,
    video: defaultBlockSpecs.video,
    table: defaultBlockSpecs.table,
    toggleListItem: defaultBlockSpecs.toggleListItem,
    callout: CalloutSpec,
    embed: EmbedSpec,
    pageBreak: createPageBreakBlockSpec(),
  };
}

function fullInlineSpecs() {
  return {
    ...defaultInlineContentSpecs,
    mention: MentionSpec,
    pageMention: PageMentionSpec,
    ...signingInlineSpecs,
  };
}

export function buildSchema(features: Features = {}) {
  const blockSpecs = fullBlockSpecs();
  const inlineContentSpecs = fullInlineSpecs();

  // Runtime trim (static type stays the superset — see TYPE NOTE above).
  const blocks = blockSpecs as Record<string, unknown>;
  const inline = inlineContentSpecs as Record<string, unknown>;
  if (!features.pageBreak) delete blocks.pageBreak;
  if (!features.images) delete blocks.image;
  if (!features.files) {
    delete blocks.file;
    delete blocks.video;
  }
  if (!features.richBlocks) {
    delete blocks.table;
    delete blocks.toggleListItem;
    delete blocks.callout;
    delete blocks.embed;
  }
  if (!features.mentions) {
    delete inline.mention;
    delete inline.pageMention;
  }
  if (!features.signing) {
    for (const key of Object.keys(signingInlineSpecs)) delete inline[key];
  }

  return BlockNoteSchema.create({ blockSpecs, inlineContentSpecs });
}

export type DocSchema = ReturnType<typeof buildSchema>;
/** The editor instance type every helper/surface should use. */
export type DocEditorInstance = DocSchema["BlockNoteEditor"];
/** Full block JSON (what editor.document / onChange emit). */
export type DocBlock = DocSchema["Block"];
/** Loose block JSON accepted as initialContent / insert payloads. */
export type DocPartialBlock = DocSchema["PartialBlock"];
