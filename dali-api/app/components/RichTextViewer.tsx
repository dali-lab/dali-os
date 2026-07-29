import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useEffect } from "react";
import {
  EDITOR_VIEWER_CONTENT_CLASS,
  isEmptyDoc,
  linkExtension,
} from "./editor/shared";
import { mentionViewerExtension } from "./editor/mention";
import { readonlyRichExtensions } from "./editor/rich-nodes";

interface RichTextViewerProps {
  content: unknown;
  className?: string;
  // Render @-mention nodes (page-doc guides). Off elsewhere — no other surface
  // stores mention nodes today.
  enableMentions?: boolean;
}

// Re-exported for back-compat: many call sites import isEmptyDoc from here.
export { isEmptyDoc };

export function RichTextViewer({ content, className, enableMentions = false }: RichTextViewerProps) {
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit,
      linkExtension({ interactive: true }),
      // Full static schema so images, tables, callouts, colors, highlights,
      // line spacing, and toggle blocks the editor produces render instead of
      // being silently dropped.
      ...readonlyRichExtensions(),
      ...(enableMentions ? [mentionViewerExtension()] : []),
    ],
    content: isEmptyDoc(content) ? "" : (content as object),
    editable: false,
    editorProps: {
      attributes: {
        class: EDITOR_VIEWER_CONTENT_CLASS,
      },
    },
  });

  useEffect(() => {
    if (!editor) return;
    if (isEmptyDoc(content)) {
      editor.commands.setContent("");
    } else {
      editor.commands.setContent(content as object);
    }
  }, [editor, content]);

  if (isEmptyDoc(content)) return null;

  return (
    <div className={className}>
      <EditorContent editor={editor} />
    </div>
  );
}
