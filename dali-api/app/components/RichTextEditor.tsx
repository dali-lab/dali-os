import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { useEffect, useRef, useState } from "react";
import {
  Bold,
  Italic,
  Strikethrough,
  Code,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  Quote,
  Link2,
  Link2Off,
  Undo2,
  Redo2,
  AlignLeft,
  AlignRight,
  AlignJustify,
  Image as ImageIcon,
} from "lucide-react";
import {
  EDITOR_CONTENT_CLASS,
  EditorShell,
  isProseMirrorDoc,
  linkExtension,
} from "./editor/shared";
import { mentionEditorExtension, searchMentionableUsers } from "./editor/mention";
import { imageEditorExtensions, uploadEditorImage } from "./editor/image";
import { signingFieldExtensions } from "./editor/signing-fields";
import { SIGNING_FIELD_TYPES, FIELD_LABEL } from "~/lib/signing-fields";
import { ALL_SIGNING_VARIABLES } from "~/lib/signing-variables";
import { useDialog, type DialogApi } from "~/components/ui/dialog";

interface RichTextEditorProps {
  value: unknown;
  onChange: (json: unknown) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  // Opt in to @-mention typeahead (page-doc guides). Off by default so other
  // editor surfaces (mentorship notes, form builder) don't fire member lookups.
  enableMentions?: boolean;
  // Show the persistent Google-Docs-style formatting toolbar (bold/italic/
  // headings/lists/quote/link/undo). Off by default — other surfaces keep the
  // minimal selection-only link toolbar.
  richToolbar?: boolean;
  // Opt in to pasting/dropping images, uploaded to S3 and inserted by URL
  // (same pipeline as the collaborative editor). Off by default: the short
  // description fields this component also backs shouldn't accept images.
  // RichTextViewer needs the matching flag, or saved images won't render.
  enableImages?: boolean;
  // Opt in to placeable signing fields + merge variables (document-signing
  // authoring). When set, the rich toolbar gains an "Insert" group that drops
  // fields for the given roles. RichTextViewer needs enableSigningFields to
  // render them back. Off by default.
  signingRoles?: string[];
}

const LINK_PROTOCOLS = ["http", "https", "mailto"];

export function isSafeLinkUrl(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed) return false;
  try {
    const url = new URL(trimmed);
    const protocol = url.protocol.replace(/:$/, "").toLowerCase();
    return LINK_PROTOCOLS.includes(protocol);
  } catch {
    return false;
  }
}

export function RichTextEditor({
  value,
  onChange,
  placeholder = "Write a description…",
  disabled = false,
  className,
  enableMentions = false,
  richToolbar = false,
  enableImages = false,
  signingRoles,
}: RichTextEditorProps) {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const [imageError, setImageError] = useState<string | null>(null);
  // The extension list is built once, so reach the current setter through a ref
  // rather than closing over the first render's.
  const imageErrorRef = useRef(setImageError);
  imageErrorRef.current = setImageError;

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit,
      Placeholder.configure({ placeholder }),
      linkExtension({ interactive: false }),
      ...(enableMentions ? [mentionEditorExtension(searchMentionableUsers)] : []),
      ...(enableImages ? imageEditorExtensions((m) => imageErrorRef.current(m)) : []),
      ...(signingRoles ? signingFieldExtensions({ mode: "author" }) : []),
    ],
    content: isProseMirrorDoc(value) ? (value as object) : "",
    editable: !disabled,
    editorProps: {
      attributes: {
        class: EDITOR_CONTENT_CLASS,
      },
    },
    onUpdate: ({ editor }) => {
      onChangeRef.current(editor.getJSON());
    },
  });

  useEffect(() => {
    if (editor) editor.setEditable(!disabled);
  }, [editor, disabled]);

  return (
    <EditorShell disabled={disabled} className={className}>
      {editor && !disabled ? (
        richToolbar ? (
          <FormattingToolbar editor={editor} signingRoles={signingRoles} enableImages={enableImages} />
        ) : (
          <Toolbar editor={editor} />
        )
      ) : null}
      <EditorContent editor={editor} />
      {imageError && (
        <p className="px-3 pb-2 text-xs text-destructive">
          Couldn't add the image — {imageError}
        </p>
      )}
    </EditorShell>
  );
}

// Shared link prompt used by both toolbars. Callers pass the dialog API (the
// prompt can't call the hook itself — it isn't a component). URL safety is
// enforced inline via the prompt's validate, so the field can't be submitted
// with a disallowed protocol.
async function promptForLink(editor: Editor, dialog: DialogApi) {
  const previous = (editor.getAttributes("link").href as string | undefined) ?? "";
  const input = await dialog.prompt({
    title: previous ? "Edit link" : "Add link",
    label: "URL",
    placeholder: "https:// or mailto:",
    defaultValue: previous,
    confirmLabel: "Save",
    validate: (value) => {
      const trimmed = value.trim();
      if (!trimmed) return null; // empty clears the link
      return isSafeLinkUrl(trimmed)
        ? null
        : "Only http(s):// and mailto: links are allowed.";
    },
  });
  if (input === null) return;
  const trimmed = input.trim();
  if (!trimmed) {
    editor.chain().focus().extendMarkRange("link").unsetLink().run();
    return;
  }
  editor.chain().focus().extendMarkRange("link").setLink({ href: trimmed }).run();
}

// ─── Full formatting toolbar (Google-Docs-style, always visible) ────────────

type ToolbarAction = {
  label: string;
  icon: typeof Bold;
  isActive?: (e: Editor) => boolean;
  isDisabled?: (e: Editor) => boolean;
  run: (e: Editor) => void;
};

const FORMAT_GROUPS: ToolbarAction[][] = [
  [
    {
      label: "Undo",
      icon: Undo2,
      isDisabled: (e) => !e.can().undo(),
      run: (e) => e.chain().focus().undo().run(),
    },
    {
      label: "Redo",
      icon: Redo2,
      isDisabled: (e) => !e.can().redo(),
      run: (e) => e.chain().focus().redo().run(),
    },
  ],
  [
    { label: "Bold", icon: Bold, isActive: (e) => e.isActive("bold"), run: (e) => e.chain().focus().toggleBold().run() },
    { label: "Italic", icon: Italic, isActive: (e) => e.isActive("italic"), run: (e) => e.chain().focus().toggleItalic().run() },
    { label: "Strikethrough", icon: Strikethrough, isActive: (e) => e.isActive("strike"), run: (e) => e.chain().focus().toggleStrike().run() },
    { label: "Inline code", icon: Code, isActive: (e) => e.isActive("code"), run: (e) => e.chain().focus().toggleCode().run() },
  ],
  [
    { label: "Heading 1", icon: Heading1, isActive: (e) => e.isActive("heading", { level: 1 }), run: (e) => e.chain().focus().toggleHeading({ level: 1 }).run() },
    { label: "Heading 2", icon: Heading2, isActive: (e) => e.isActive("heading", { level: 2 }), run: (e) => e.chain().focus().toggleHeading({ level: 2 }).run() },
    { label: "Heading 3", icon: Heading3, isActive: (e) => e.isActive("heading", { level: 3 }), run: (e) => e.chain().focus().toggleHeading({ level: 3 }).run() },
  ],
  [
    { label: "Bullet list", icon: List, isActive: (e) => e.isActive("bulletList"), run: (e) => e.chain().focus().toggleBulletList().run() },
    { label: "Numbered list", icon: ListOrdered, isActive: (e) => e.isActive("orderedList"), run: (e) => e.chain().focus().toggleOrderedList().run() },
    { label: "Quote", icon: Quote, isActive: (e) => e.isActive("blockquote"), run: (e) => e.chain().focus().toggleBlockquote().run() },
  ],
  // Image wrapping. Only meaningful with an image selected, so the whole group
  // disables otherwise rather than silently doing nothing. `align` is a plain
  // node attribute, so updateAttributes is the whole implementation.
  [
    {
      label: "Image left, text wraps right",
      icon: AlignLeft,
      isActive: (e) => e.isActive("image", { align: "left" }),
      isDisabled: (e) => !e.isActive("image"),
      run: (e) => e.chain().focus().updateAttributes("image", { align: "left" }).run(),
    },
    {
      label: "Image right, text wraps left",
      icon: AlignRight,
      isActive: (e) => e.isActive("image", { align: "right" }),
      isDisabled: (e) => !e.isActive("image"),
      run: (e) => e.chain().focus().updateAttributes("image", { align: "right" }).run(),
    },
    {
      label: "Image on its own line",
      icon: AlignJustify,
      isActive: (e) => e.isActive("image") && !e.getAttributes("image").align,
      isDisabled: (e) => !e.isActive("image"),
      run: (e) => e.chain().focus().updateAttributes("image", { align: null }).run(),
    },
  ],
];

function FormattingToolbar({
  editor,
  signingRoles,
  enableImages,
}: {
  editor: Editor;
  signingRoles?: string[];
  enableImages?: boolean;
}) {
  const dialog = useDialog();
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  // Tiptap doesn't re-render React on its own; tick on every transaction so
  // active/disabled states track the selection.
  const [, setTick] = useState(0);
  useEffect(() => {
    const rerender = () => setTick((t) => t + 1);
    editor.on("transaction", rerender);
    return () => {
      editor.off("transaction", rerender);
    };
  }, [editor]);

  const linkActive = editor.isActive("link");

  return (
    <div className="flex flex-wrap items-center gap-0.5 border-b border-gray-200 px-1.5 py-1">
      {FORMAT_GROUPS.map((group, gi) => (
        <div key={gi} className="flex items-center gap-0.5">
          {gi > 0 && <span className="mx-1 h-5 w-px bg-border" aria-hidden />}
          {group.map(({ label, icon: Icon, isActive, isDisabled, run }) => {
            const active = isActive?.(editor) ?? false;
            const dis = isDisabled?.(editor) ?? false;
            return (
              <button
                key={label}
                type="button"
                title={label}
                aria-label={label}
                aria-pressed={active}
                disabled={dis}
                onMouseDown={(e) => {
                  e.preventDefault();
                  run(editor);
                }}
                className={`rounded p-1.5 transition-colors disabled:opacity-40 disabled:pointer-events-none ${
                  active
                    ? "bg-accent-coral/15 text-accent-coral"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                }`}
              >
                <Icon size={15} />
              </button>
            );
          })}
        </div>
      ))}
      <span className="mx-1 h-5 w-px bg-border" aria-hidden />
      <button
        type="button"
        title={linkActive ? "Edit link" : "Add link"}
        aria-label={linkActive ? "Edit link" : "Add link"}
        aria-pressed={linkActive}
        onMouseDown={(e) => {
          e.preventDefault();
          promptForLink(editor, dialog);
        }}
        className={`rounded p-1.5 transition-colors ${
          linkActive
            ? "bg-accent-coral/15 text-accent-coral"
            : "text-muted-foreground hover:text-foreground hover:bg-muted"
        }`}
      >
        <Link2 size={15} />
      </button>
      {linkActive && (
        <button
          type="button"
          title="Remove link"
          aria-label="Remove link"
          onMouseDown={(e) => {
            e.preventDefault();
            editor.chain().focus().extendMarkRange("link").unsetLink().run();
          }}
          className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <Link2Off size={15} />
        </button>
      )}
      {enableImages && (
        <>
          <span className="mx-1 h-5 w-px bg-border" aria-hidden />
          <button
            type="button"
            title="Insert image"
            aria-label="Insert image"
            onMouseDown={(e) => {
              e.preventDefault();
              imageInputRef.current?.click();
            }}
            className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <ImageIcon size={15} />
          </button>
          <input
            ref={imageInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              try {
                const src = await uploadEditorImage(file);
                editor.chain().focus().insertContent({ type: "image", attrs: { src } }).run();
              } catch (err) {
                console.error("[editor] image insert failed", err);
              }
            }}
          />
        </>
      )}
      {signingRoles && signingRoles.length > 0 && (
        <>
          <span className="mx-1 h-5 w-px bg-border" aria-hidden />
          <SigningInsertControls editor={editor} roles={signingRoles} />
        </>
      )}
    </div>
  );
}

// Insert-field controls for document-signing authoring. The author picks the
// signer role, then drops a field for that role; a separate dropdown inserts a
// merge variable. Fields/variables are inline atom nodes, so a plain
// insertContent is the whole implementation.
function SigningInsertControls({ editor, roles }: { editor: Editor; roles: string[] }) {
  const [role, setRole] = useState(roles[0] ?? "member");

  const insertField = (type: string) => {
    editor
      .chain()
      .focus()
      .insertContent({
        type,
        attrs: { fieldId: crypto.randomUUID(), role, required: true },
      })
      .run();
  };

  const insertVariable = (name: string) => {
    if (!name) return;
    editor.chain().focus().insertContent({ type: "variable", attrs: { name } }).run();
  };

  return (
    <div className="flex items-center gap-1">
      <select
        value={role}
        onChange={(e) => setRole(e.target.value)}
        title="Signer role for inserted fields"
        className="rounded border border-border bg-card px-1.5 py-1 text-xs text-foreground"
      >
        {roles.map((r) => (
          <option key={r} value={r}>
            {r}
          </option>
        ))}
      </select>
      {SIGNING_FIELD_TYPES.map((type) => (
        <button
          key={type}
          type="button"
          title={`Insert ${FIELD_LABEL[type]} field (${role})`}
          onMouseDown={(e) => {
            e.preventDefault();
            insertField(type);
          }}
          className="rounded px-1.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          {FIELD_LABEL[type]}
        </button>
      ))}
      <select
        value=""
        onChange={(e) => {
          insertVariable(e.target.value);
          e.currentTarget.value = "";
        }}
        title="Insert a merge variable"
        className="rounded border border-border bg-card px-1.5 py-1 text-xs text-muted-foreground"
      >
        <option value="">+ Variable</option>
        {ALL_SIGNING_VARIABLES.map((v) => (
          <option key={v} value={v}>
            {`{{${v}}}`}
          </option>
        ))}
      </select>
    </div>
  );
}

// ─── Minimal selection-only link toolbar (default for other surfaces) ───────

function Toolbar({ editor }: { editor: Editor }) {
  const dialog = useDialog();
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const rerender = () => setVersion(v => v + 1);
    editor.on("selectionUpdate", rerender);
    editor.on("transaction", rerender);
    return () => {
      editor.off("selectionUpdate", rerender);
      editor.off("transaction", rerender);
    };
  }, [editor]);

  const { from, to } = editor.state.selection;
  const hasSelection = from !== to;
  const isLinkActive = editor.isActive("link");

  const setLink = () => promptForLink(editor, dialog);

  const unsetLink = () => {
    editor.chain().focus().extendMarkRange("link").unsetLink().run();
  };

  // version is read so React picks up active-state changes from editor events
  void version;

  if (!hasSelection && !isLinkActive) return null;

  return (
    <div className="flex flex-wrap items-center gap-1 gap-y-1 border-b border-gray-200 px-2 py-1">
      <button
        type="button"
        onClick={setLink}
        className={`rounded p-2 text-sm font-medium sm:px-2 sm:py-1 sm:text-xs ${
          isLinkActive
            ? "bg-blue-100 text-blue-800"
            : "text-gray-700 hover:bg-gray-100"
        }`}
        aria-label={isLinkActive ? "Edit link" : "Add link"}
      >
        {isLinkActive ? "Edit link" : "Link"}
      </button>
      {isLinkActive && (
        <button
          type="button"
          onClick={unsetLink}
          className="rounded p-2 text-sm font-medium text-gray-700 hover:bg-gray-100 sm:px-2 sm:py-1 sm:text-xs"
          aria-label="Remove link"
        >
          Remove link
        </button>
      )}
    </div>
  );
}
