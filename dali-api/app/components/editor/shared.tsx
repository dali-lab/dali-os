import { forwardRef, type ReactNode } from "react";
import Link from "@tiptap/extension-link";

export const EDITOR_CONTENT_CLASS =
  "prose prose-sm max-w-none focus:outline-none min-h-[6rem] px-3 py-2";
// Viewer has no min-height/padding (RichTextViewer's read-only variant).
export const EDITOR_VIEWER_CONTENT_CLASS =
  "prose prose-sm max-w-none focus:outline-none";

const LINK_HTML_ATTRIBUTES = {
  target: "_blank",
  rel: "noopener noreferrer nofollow",
  class: "text-blue-600 underline hover:text-blue-800",
};

const LINK_PROTOCOLS = ["http", "https", "mailto"];

// interactive=true → viewer (click-through, no autolink/paste capture);
// interactive=false → editor (autolink + linkOnPaste, click disabled).
export function linkExtension({ interactive }: { interactive: boolean }) {
  return Link.configure({
    openOnClick: interactive,
    autolink: !interactive,
    linkOnPaste: !interactive,
    protocols: LINK_PROTOCOLS,
    HTMLAttributes: LINK_HTML_ATTRIBUTES,
  });
}

export function isProseMirrorDoc(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const maybe = value as { type?: unknown; content?: unknown };
  return maybe.type === "doc";
}

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

interface EditorShellProps {
  disabled?: boolean;
  className?: string;
  relative?: boolean; // CollaborativeEditor needs position:relative for its overlay buttons
  children: ReactNode;
}

export const EditorShell = forwardRef<HTMLDivElement, EditorShellProps>(
  function EditorShell(
    { disabled = false, className, relative = false, children },
    ref,
  ) {
    return (
      <div
        ref={ref}
        className={`${relative ? "relative " : ""}rounded-lg border bg-card ${
          disabled
            ? "border-border bg-muted/50 opacity-75"
            : "border-gray-300 focus-within:ring-2 focus-within:ring-accent-coral focus-within:border-transparent"
        } ${className ?? ""}`}
      >
        {children}
      </div>
    );
  },
);
