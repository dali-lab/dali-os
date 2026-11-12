import { createExtension } from "@blocknote/core";
import type { Node } from "prosemirror-model";
import { Plugin, PluginKey } from "prosemirror-state";
import type { DocEditorInstance } from "./schema/build";

export interface MediaTarget {
  blockId: string;
  placement: "before" | "after";
}

function hasText(html: string): boolean {
  return Boolean(new DOMParser().parseFromString(html, "text/html").body.textContent?.trim());
}

// BlockNote only uploads when files are the sole clipboard type, so "Copy image"
// (img markup + file) and Finder (file name + file) paste the wrong thing.
export function filesToUpload(data: DataTransfer | null): File[] {
  if (!data || !data.types.includes("Files") || data.types.includes("blocknote/html")) return [];
  if (data.types.includes("text/html") && hasText(data.getData("text/html"))) return [];
  return Array.from(data.files ?? []);
}

function mediaBlockType(editor: DocEditorInstance, file: File): string | null {
  const blocks = editor.schema.blockSchema;
  const kind = file.type.split("/")[0];
  if ((kind === "image" || kind === "video") && kind in blocks) return kind;
  return "file" in blocks ? "file" : null;
}

function isEmptyTextBlock(block: unknown): boolean {
  const content = (block as { content?: unknown }).content;
  return Array.isArray(content) && content.length === 0;
}

export function insertMediaFiles(editor: DocEditorInstance, files: File[], target: MediaTarget): void {
  const upload = editor.uploadFile;
  if (!upload) return;
  let at = target;
  for (const file of files) {
    const type = mediaBlockType(editor, file);
    const ref = editor.getBlock(at.blockId);
    if (!type || !ref) continue;
    const block = { type, props: { name: file.name } } as never;
    const id = isEmptyTextBlock(ref)
      ? editor.updateBlock(ref, block).id
      : editor.insertBlocks([block], ref, at.placement)[0]!.id;
    at = { blockId: id, placement: "after" };
    editor.domElement?.querySelector(`[data-id="${id}"]`)?.scrollIntoView?.({ block: "nearest" });
    void upload(file, id)
      .then((result) => {
        if (!editor.getBlock(id)) return;
        editor.updateBlock(id, (typeof result === "string" ? { props: { url: result } } : result) as never);
      })
      .catch(() => {});
  }
}

export function pasteTarget(editor: DocEditorInstance): MediaTarget {
  return { blockId: editor.getTextCursorPosition().block.id, placement: "after" };
}

function blockAt(doc: Node, pos: number): Node | null {
  const $pos = doc.resolve(pos);
  for (let depth = $pos.depth; depth > 0; depth--) {
    if ($pos.node(depth).type.name === "blockContainer") return $pos.node(depth);
  }
  const beside = $pos.nodeAfter ?? $pos.nodeBefore;
  return beside?.type.name === "blockContainer" ? beside : null;
}

export function dropTarget(editor: DocEditorInstance, event: DragEvent): MediaTarget | null {
  const view = editor.prosemirrorView;
  const hit = view.posAtCoords({ left: event.clientX, top: event.clientY });
  const container = hit ? blockAt(view.state.doc, hit.pos) : null;
  if (!container) return null;
  const blockId = container.attrs.id as string;
  if (container.firstChild?.type.name === "table") return { blockId, placement: "after" };
  const rect = editor.domElement?.querySelector(`[data-id="${blockId}"]`)?.getBoundingClientRect();
  const above = rect && (rect.top + rect.bottom) / 2 > event.clientY;
  return { blockId, placement: above ? "before" : "after" };
}

export const mediaDropKey = new PluginKey("dali-media-drop");

export const MediaDropExtension = createExtension(({ editor }) => ({
  key: "dali-media-drop",
  prosemirrorPlugins: [
    new Plugin({
      key: mediaDropKey,
      props: {
        handleDOMEvents: {
          drop(_view, event) {
            const doc = editor as unknown as DocEditorInstance;
            if (!doc.isEditable || !doc.uploadFile) return false;
            const files = filesToUpload(event.dataTransfer);
            const target = files.length ? dropTarget(doc, event) : null;
            if (!target) return false;
            event.preventDefault();
            insertMediaFiles(doc, files, target);
            return true;
          },
        },
      },
    }),
  ],
}));
