// LEGACY (pre-BlockNote) — pure ProseMirror-JSON → Yjs conversion for the old
// Tiptap pipeline. Retained only so historical PM JSON can still be validated
// or replayed; the live write path is blocks → "blocknote" fragment
// (blocksToFragment in ../blocknote-server.ts).

import * as Y from "yjs";
import { getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import { prosemirrorJSONToYDoc } from "y-prosemirror";
import type { PMNode } from "../export-html";

// Mirrors the legacy client editor's schema (StarterKit + page-body images).
// Mention was client-only and never appears in generated content.
const schema = getSchema([StarterKit, Image]);

// Convert generated ProseMirror JSON into a standalone Y.Doc whose "default"
// XmlFragment y-prosemirror/Tiptap bind to. Throws if the JSON doesn't
// validate against the schema — callers surface that as invalid input.
export function pmJsonToYDoc(doc: PMNode): Y.Doc {
  return prosemirrorJSONToYDoc(schema, doc, "default");
}

// Deep-copy `source`'s fragment children over `target`'s. Clone is required —
// Y types are bound to their doc and can't be inserted into another directly.
export function replaceFragment(target: Y.XmlFragment, source: Y.XmlFragment): void {
  target.delete(0, target.length);
  const cloned: Y.XmlElement[] = [];
  for (let i = 0; i < source.length; i++) {
    const node = source.get(i);
    if (node instanceof Y.XmlElement) cloned.push(node.clone());
  }
  if (cloned.length > 0) target.push(cloned);
}
