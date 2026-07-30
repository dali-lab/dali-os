import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import { useEffect } from "react";
import {
  EDITOR_VIEWER_CONTENT_CLASS,
  isEmptyDoc,
  linkExtension,
} from "./editor/shared";
import { mentionViewerExtension } from "./editor/mention";

interface RichTextViewerProps {
  content: unknown;
  className?: string;
  // Render @-mention nodes (page-doc guides). Off elsewhere — no other surface
  // stores mention nodes today.
  enableMentions?: boolean;
  // Render image nodes. Must be on wherever RichTextEditor had enableImages,
  // or Tiptap drops the nodes it doesn't know and the images vanish on read.
  enableImages?: boolean;
}

// Re-exported for back-compat: many call sites import isEmptyDoc from here.
export { isEmptyDoc };

export function RichTextViewer({
  content,
  className,
  enableMentions = false,
  enableImages = false,
}: RichTextViewerProps) {
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit,
      linkExtension({ interactive: true }),
      ...(enableMentions ? [mentionViewerExtension()] : []),
      ...(enableImages ? [Image.configure({ allowBase64: false })] : []),
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
