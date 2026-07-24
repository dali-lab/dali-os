// Pure ProseMirror-JSON → Yjs conversion. Sibling of import-markdown.ts on
// the write pipeline: no DB or Hocuspocus import so it's unit-testable. The
// DB/live-doc-coupled replaceCollabDocContent in write.ts consumes these.

import * as Y from "yjs";
import { getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import { prosemirrorJSONToYDoc } from "y-prosemirror";
import type { PMNode } from "./export-html";

// Mirrors the client editor's schema (CollaborativeEditor.tsx: StarterKit +
// page-body images). Mention is client-only and never appears in generated
// content, so it's omitted; replacing a body that contained mentions is fine —
// the old fragment is deleted wholesale, never re-validated against this schema.
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
