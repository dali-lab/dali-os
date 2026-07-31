// Capability presets — the single source that maps a surface's declared
// features to the actual Tiptap extension list, for BOTH the editor and its
// read-side viewer. Passing the same features through one resolver is what makes
// editor↔viewer parity structural: a capability enabled on one side can't be
// forgotten on the other (the long-standing "parity tax" documented in
// RichTextViewer.tsx / image.ts). Consumed by RichTextEditor, RichTextViewer,
// SigningFillView, and (for the capability slice) CollaborativeEditor.

import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import type { Extensions } from "@tiptap/core";

import { linkExtension } from "./shared";
import {
  mentionEditorExtension,
  mentionViewerExtension,
  searchMentionableUsers,
} from "./mention";
import { imageEditorExtensions, imageExtension } from "./image";
import { richBlockExtensions } from "./blocks";
import { slashCommandExtension } from "./slash-menu";
import {
  signingFieldExtensions,
  type SigningFieldCtx,
  type SigningFieldMode,
} from "./signing-fields";

// The signing sub-feature is structured, not a bare boolean: the editor (author)
// side needs the signer roles for its insert controls, and the viewer/fill side
// needs resolved variables + captured values. Folding both into one declared
// feature keeps the toolbar's role picker and the viewer's variable resolution
// driven off the same capability.
export interface SigningFeature {
  roles?: string[];
  variables?: Record<string, string>;
  values?: Record<string, unknown>;
}

export interface EditorFeatures {
  mentions?: boolean;
  images?: boolean;
  richBlocks?: boolean; // tables / task lists / callout (+ slash menu on editors)
  signing?: boolean | SigningFeature;
}

export type EditorPresetName = "field" | "notes" | "agreement" | "guide" | "document";

export const EDITOR_PRESETS: Record<EditorPresetName, EditorFeatures> = {
  field: {}, // short structured input: link-on-selection only, no images
  notes: { images: true }, // mentorship notes/templates, hiring notes
  agreement: { images: true, signing: true }, // signing document body
  guide: { mentions: true, images: true }, // page-doc guides
  document: { mentions: true, images: true, richBlocks: true }, // full document
};

export function resolveFeatures(input: EditorPresetName | EditorFeatures): EditorFeatures {
  return typeof input === "string" ? EDITOR_PRESETS[input] : input;
}

export type EditorSide = "editor" | "viewer";

function normSigning(features: EditorFeatures): SigningFeature | null {
  if (!features.signing) return null;
  return features.signing === true ? {} : features.signing;
}

export interface CapabilityOpts {
  side: EditorSide;
  // editor: reports image-upload failures to the host.
  onImageError?: (message: string) => void;
  // editor: include the "/" slash menu alongside rich blocks (collab docs).
  withSlashMenu?: boolean;
  // Overrides for the signing context, e.g. fill mode on the signer surface.
  signingCtx?: Partial<Pick<SigningFieldCtx, "mode" | "signerRole" | "onFieldChange">>;
}

// THE capability→extension mapping. Returns only the capability extensions (no
// StarterKit / link) so hosts that own their base — CollaborativeEditor — can
// spread it into their own list. buildExtensions() wraps this with the base for
// the non-collab editor/viewer.
export function capabilityExtensions(
  features: EditorFeatures,
  opts: CapabilityOpts,
): Extensions {
  const { side } = opts;
  const out: Extensions = [];

  if (features.mentions) {
    out.push(
      side === "editor"
        ? mentionEditorExtension(searchMentionableUsers)
        : mentionViewerExtension(),
    );
  }

  if (features.images) {
    if (side === "editor") out.push(...imageEditorExtensions(opts.onImageError));
    else out.push(imageExtension());
  }

  if (features.richBlocks) {
    out.push(...richBlockExtensions());
    if (opts.withSlashMenu && side === "editor") out.push(slashCommandExtension());
  }

  const sign = normSigning(features);
  if (sign) {
    const mode: SigningFieldMode =
      opts.signingCtx?.mode ?? (side === "editor" ? "author" : "view");
    out.push(
      ...signingFieldExtensions({
        mode,
        variables: sign.variables,
        values: sign.values,
        signerRole: opts.signingCtx?.signerRole,
        onFieldChange: opts.signingCtx?.onFieldChange,
      }),
    );
  }

  return out;
}

export interface BuildOpts {
  side: EditorSide;
  placeholder?: string; // editor only
  onImageError?: (message: string) => void;
  signingCtx?: CapabilityOpts["signingCtx"];
}

// Full extension list for the non-collab RichTextEditor / RichTextViewer: base
// (StarterKit + link, plus Placeholder on the editor) followed by the resolved
// capability extensions.
export function buildExtensions(features: EditorFeatures, opts: BuildOpts): Extensions {
  const { side } = opts;
  return [
    StarterKit,
    ...(side === "editor" ? [Placeholder.configure({ placeholder: opts.placeholder ?? "" })] : []),
    linkExtension({ interactive: side === "viewer" }),
    ...capabilityExtensions(features, {
      side,
      onImageError: opts.onImageError,
      signingCtx: opts.signingCtx,
    }),
  ];
}
