import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import { useEffect } from "react";

interface RichTextViewerProps {
  content: unknown;
  className?: string;
}

const LINK_HTML_ATTRIBUTES = {
  target: "_blank",
  rel: "noopener noreferrer nofollow",
  class: "text-blue-600 underline hover:text-blue-800",
};

export function isEmptyDoc(content: unknown): boolean {
  if (!content || typeof content !== "object") return true;
  const doc = content as { type?: unknown; content?: unknown };
  if (doc.type !== "doc") return true;
  if (!Array.isArray(doc.content) || doc.content.length === 0) return true;
  return doc.content.every(node => isEmptyNode(node));
}

function isEmptyNode(node: unknown): boolean {
  if (!node || typeof node !== "object") return true;
  const n = node as { content?: unknown; text?: unknown };
  if (typeof n.text === "string" && n.text.length > 0) return false;
  if (Array.isArray(n.content) && n.content.length > 0) {
    return n.content.every(child => isEmptyNode(child));
  }
  return true;
}

export function RichTextViewer({ content, className }: RichTextViewerProps) {
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit,
      Link.configure({
        openOnClick: true,
        autolink: false,
        linkOnPaste: false,
        protocols: ["http", "https", "mailto"],
        HTMLAttributes: LINK_HTML_ATTRIBUTES,
      }),
    ],
    content: isEmptyDoc(content) ? "" : (content as object),
    editable: false,
    editorProps: {
      attributes: {
        class: "prose prose-sm max-w-none focus:outline-none",
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
