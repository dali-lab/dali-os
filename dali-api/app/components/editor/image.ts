// Page-body image support: the official Tiptap Image node plus paste/drop
// upload handling. Images are uploaded to S3 (via the existing presign flow)
// and inserted by URL — never as base64 data URLs, which would bloat every
// Yjs update, snapshot, and peer sync. The stored src is /api/upload/raw,
// a stable session-authed redirect to a fresh presigned S3 GET, so it keeps
// working long after any individual presigned URL expires.

import Image from "@tiptap/extension-image";
import { Extension } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { uploadFileToS3 } from "~/lib/upload-client";

export const IMAGE_UPLOAD_ACCEPT = "image/*";
const UPLOAD_KEY_PREFIX = "doc-images";

export function rawUploadUrl(key: string): string {
  return `/api/upload/raw?key=${encodeURIComponent(key)}`;
}

// Upload one image file and return the stable src to insert.
export async function uploadEditorImage(file: File): Promise<string> {
  const meta = await uploadFileToS3(file, UPLOAD_KEY_PREFIX, IMAGE_UPLOAD_ACCEPT);
  return rawUploadUrl(meta.s3Key);
}

function imageFiles(list: FileList | undefined | null): File[] {
  return Array.from(list ?? []).filter((f) => f.type.startsWith("image/"));
}

// Upload sequentially, inserting as each finishes. The insert happens after an
// async gap, so it targets the *current* state (replaceSelectionWith), not a
// position captured before the upload — collaborators may have typed meanwhile.
async function uploadAndInsert(view: EditorView, files: File[], dropPos?: number) {
  let pos = dropPos;
  for (const file of files) {
    try {
      const src = await uploadEditorImage(file);
      const alt = file.name.replace(/\.[^.]+$/, "");
      const node = view.state.schema.nodes.image.create({ src, alt });
      if (pos !== undefined) {
        const clamped = Math.min(pos, view.state.doc.content.size);
        view.dispatch(view.state.tr.insert(clamped, node));
        pos = clamped + node.nodeSize;
      } else {
        view.dispatch(view.state.tr.replaceSelectionWith(node));
      }
    } catch (err) {
      console.error("[editor] image upload failed", err);
    }
  }
}

const ImagePasteDrop = Extension.create({
  name: "imagePasteDrop",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          handlePaste: (view, event) => {
            const files = imageFiles(event.clipboardData?.files);
            if (files.length === 0) return false;
            event.preventDefault();
            void uploadAndInsert(view, files);
            return true;
          },
          handleDrop: (view, event) => {
            const files = imageFiles(event.dataTransfer?.files);
            if (files.length === 0) return false;
            event.preventDefault();
            const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
            void uploadAndInsert(view, files, pos);
            return true;
          },
        },
      }),
    ];
  },
});

export function imageEditorExtensions() {
  return [Image.configure({ allowBase64: false }), ImagePasteDrop];
}
