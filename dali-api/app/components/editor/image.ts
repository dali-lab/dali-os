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

export type ImageAlign = "left" | "right";

// Smallest width the resize handle will let an image shrink to.
const MIN_IMAGE_WIDTH = 60;

/**
 * The image node, with `align` (float) and `width` (resize) attributes.
 *
 * Exported as one configured extension rather than configured separately at
 * each call site: ProseMirror strips attributes its schema doesn't declare, so
 * a viewer that built its own Image would silently drop `align`/`width` and the
 * wrap/size would vanish the moment you stopped editing. The same node backs
 * the editor, the read-only viewer, and the collab editor.
 *
 * Kept as a block node on purpose. Making images inline would let them sit in a
 * paragraph, but it also invalidates every image already stored at block level.
 */
const AlignableImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      align: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-align"),
        renderHTML: (attributes) => {
          const align = (attributes as { align?: string | null }).align;
          return align ? { "data-align": align } : {};
        },
      },
      // Rendered width in CSS pixels, set by dragging the resize handle. Stored
      // on the node so it round-trips through the viewer, collab sync, and HTML
      // export exactly like `align`.
      width: {
        default: null,
        parseHTML: (element) => {
          const raw =
            element.getAttribute("width") || (element as HTMLElement).style?.width;
          const n = raw ? parseInt(raw, 10) : NaN;
          return Number.isFinite(n) && n > 0 ? n : null;
        },
        renderHTML: (attributes) => {
          const width = (attributes as { width?: number | null }).width;
          return width ? { width: String(width), style: `width: ${width}px` } : {};
        },
      },
    };
  },

  // Node view: wraps the <img> so it can carry a drag-to-resize handle. The
  // handle is only added in editable mode, so read-only viewers get the same
  // wrapper (a stored width still renders) without the affordance. Plain DOM,
  // matching the callout/signing node views.
  addNodeView() {
    return ({ node, editor, getPos }) => {
      let current = node;
      const wrapper = document.createElement("div");
      wrapper.className = "editor-image";
      const img = document.createElement("img");
      wrapper.appendChild(img);

      const render = () => {
        img.src = String(current.attrs.src ?? "");
        img.alt = current.attrs.alt ? String(current.attrs.alt) : "";
        if (current.attrs.width) img.style.width = `${current.attrs.width}px`;
        else img.style.removeProperty("width");
        if (current.attrs.align) wrapper.setAttribute("data-align", String(current.attrs.align));
        else wrapper.removeAttribute("data-align");
      };
      render();

      if (editor.isEditable) {
        wrapper.classList.add("editor-image--editable");
        const handle = document.createElement("span");
        handle.className = "editor-image__resize";
        handle.setAttribute("contenteditable", "false");
        handle.setAttribute("aria-hidden", "true");
        wrapper.appendChild(handle);

        handle.addEventListener("pointerdown", (event) => {
          // Resize, don't start a node-drag or a text selection.
          event.preventDefault();
          event.stopPropagation();
          const startX = event.clientX;
          const startWidth = img.getBoundingClientRect().width;
          // Never wider than the editor's content box, so it can't overflow.
          const maxWidth = (editor.view.dom as HTMLElement).clientWidth || startWidth;

          const onMove = (move: PointerEvent) => {
            const next = Math.max(
              MIN_IMAGE_WIDTH,
              Math.min(maxWidth, startWidth + (move.clientX - startX)),
            );
            img.style.width = `${Math.round(next)}px`;
          };
          const onUp = () => {
            document.removeEventListener("pointermove", onMove);
            document.removeEventListener("pointerup", onUp);
            const finalWidth = Math.round(img.getBoundingClientRect().width);
            const pos = typeof getPos === "function" ? getPos() : null;
            if (pos != null) {
              editor.view.dispatch(
                editor.view.state.tr.setNodeMarkup(pos, undefined, {
                  ...current.attrs,
                  width: finalWidth,
                }),
              );
            }
          };
          document.addEventListener("pointermove", onMove);
          document.addEventListener("pointerup", onUp);
        });
      }

      return {
        dom: wrapper,
        update: (updated) => {
          if (updated.type !== current.type) return false;
          current = updated;
          render();
          return true;
        },
        // A leaf node has no editable content; every DOM change here (style,
        // handle) is cosmetic, so keep ProseMirror from re-parsing it.
        ignoreMutation: () => true,
      };
    };
  },
});

export function imageExtension() {
  return AlignableImage.configure({ allowBase64: false });
}

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
async function uploadAndInsert(
  view: EditorView,
  files: File[],
  dropPos?: number,
  onError?: (message: string) => void,
) {
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
      // Reported to the host, not just the console: a silently-swallowed
      // upload looks exactly like drag-and-drop not being wired up at all.
      console.error("[editor] image upload failed", err);
      onError?.(err instanceof Error ? err.message : "Image upload failed");
    }
  }
}

const ImagePasteDrop = Extension.create({
  name: "imagePasteDrop",
  addOptions() {
    return { onError: undefined as ((message: string) => void) | undefined };
  },
  addProseMirrorPlugins() {
    const onError = this.options.onError;
    return [
      new Plugin({
        props: {
          handlePaste: (view, event) => {
            const files = imageFiles(event.clipboardData?.files);
            if (files.length === 0) return false;
            event.preventDefault();
            void uploadAndInsert(view, files, undefined, onError);
            return true;
          },
          handleDrop: (view, event) => {
            const files = imageFiles(event.dataTransfer?.files);
            if (files.length === 0) return false;
            event.preventDefault();
            const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
            void uploadAndInsert(view, files, pos, onError);
            return true;
          },
        },
      }),
    ];
  },
});

export function imageEditorExtensions(onError?: (message: string) => void) {
  return [imageExtension(), ImagePasteDrop.configure({ onError })];
}
