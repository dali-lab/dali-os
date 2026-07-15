import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useEffect } from "react";
import {
  EDITOR_VIEWER_CONTENT_CLASS,
  isEmptyDoc,
  linkExtension,
} from "./editor/shared";

interface RichTextViewerProps {
  content: unknown;
  className?: string;
}

// Re-exported for back-compat: many call sites import isEmptyDoc from here.
export { isEmptyDoc };

export function RichTextViewer({ content, className }: RichTextViewerProps) {
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [StarterKit, linkExtension({ interactive: true })],
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
