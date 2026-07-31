// One capability-driven toolbar for every editor surface. Replaces the two
// hardcoded RichTextEditor toolbars (minimal link bar vs full formatting bar)
// AND the CollaborativeEditor's separate bar. Which button groups appear is
// derived from the active EditorFeatures, not a boolean — so the image button
// (and any future node's controls) shows up exactly where its capability is on,
// killing the "enabled-but-no-button" mismatch by construction.
//
// Host-specific concerns are injected, not branched: `history` swaps native
// undo/redo for the collab Yjs UndoManager, and the `extraFormatControls` /
// `trailing` slots let the collab editor add its color/line-spacing/toggle and
// version-history controls while sharing the identical formatting groups and
// styling — so a rich-text field and a collaborative document look the same.

import { type Editor } from "@tiptap/react";
import { type ReactNode, useEffect, useRef, useState } from "react";
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
  Crop,
} from "lucide-react";
import { NodeSelection } from "@tiptap/pm/state";
import { uploadEditorImage, IMAGE_UPLOAD_ACCEPT } from "./image";
import { ImageCropModal } from "./ImageCropModal";
import { SIGNING_FIELD_TYPES, FIELD_LABEL } from "~/lib/signing-fields";
import { ALL_SIGNING_VARIABLES } from "~/lib/signing-variables";
import { useDialog, type DialogApi } from "~/components/ui/dialog";
import type { EditorFeatures } from "./presets";

export type ToolbarDensity = "compact" | "full";

// Injected undo/redo, so the collab editor can drive its Yjs UndoManager while
// the non-collab editor falls back to native history. canUndo/canRedo are
// functions, evaluated on each transaction re-render so the enable-state stays
// live.
export interface ToolbarHistory {
  canUndo: () => boolean;
  canRedo: () => boolean;
  undo: () => void;
  redo: () => void;
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

// Shared link prompt (the prompt can't call the hook itself — it isn't a
// component — so the caller passes the dialog API). URL safety enforced inline.
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

// ─── Format groups (shared) ─────────────────────────────────────────────────

type ToolbarAction = {
  label: string;
  icon: typeof Bold;
  isActive?: (e: Editor) => boolean;
  isDisabled?: (e: Editor) => boolean;
  run: (e: Editor) => void;
};

const MARK_ACTIONS: ToolbarAction[] = [
  { label: "Bold", icon: Bold, isActive: (e) => e.isActive("bold"), run: (e) => e.chain().focus().toggleBold().run() },
  { label: "Italic", icon: Italic, isActive: (e) => e.isActive("italic"), run: (e) => e.chain().focus().toggleItalic().run() },
  { label: "Strikethrough", icon: Strikethrough, isActive: (e) => e.isActive("strike"), run: (e) => e.chain().focus().toggleStrike().run() },
  { label: "Inline code", icon: Code, isActive: (e) => e.isActive("code"), run: (e) => e.chain().focus().toggleCode().run() },
];

const HEADING_ACTIONS: ToolbarAction[] = [
  { label: "Heading 1", icon: Heading1, isActive: (e) => e.isActive("heading", { level: 1 }), run: (e) => e.chain().focus().toggleHeading({ level: 1 }).run() },
  { label: "Heading 2", icon: Heading2, isActive: (e) => e.isActive("heading", { level: 2 }), run: (e) => e.chain().focus().toggleHeading({ level: 2 }).run() },
  { label: "Heading 3", icon: Heading3, isActive: (e) => e.isActive("heading", { level: 3 }), run: (e) => e.chain().focus().toggleHeading({ level: 3 }).run() },
];

const LIST_ACTIONS: ToolbarAction[] = [
  { label: "Bullet list", icon: List, isActive: (e) => e.isActive("bulletList"), run: (e) => e.chain().focus().toggleBulletList().run() },
  { label: "Numbered list", icon: ListOrdered, isActive: (e) => e.isActive("orderedList"), run: (e) => e.chain().focus().toggleOrderedList().run() },
  { label: "Quote", icon: Quote, isActive: (e) => e.isActive("blockquote"), run: (e) => e.chain().focus().toggleBlockquote().run() },
];

// Image wrapping. Only meaningful with an image selected, so the whole group
// disables otherwise. `align` is a plain node attribute, so updateAttributes is
// the whole implementation.
const IMAGE_ALIGN_ACTIONS: ToolbarAction[] = [
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
];

function Divider() {
  return <span className="mx-1 h-5 w-px bg-border" aria-hidden />;
}

function ActionButton({ editor, action }: { editor: Editor; action: ToolbarAction }) {
  const active = action.isActive?.(editor) ?? false;
  const disabled = action.isDisabled?.(editor) ?? false;
  const Icon = action.icon;
  return (
    <button
      type="button"
      title={action.label}
      aria-label={action.label}
      aria-pressed={active}
      disabled={disabled}
      onMouseDown={(e) => {
        e.preventDefault();
        action.run(editor);
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
}

function ActionGroup({ editor, actions }: { editor: Editor; actions: ToolbarAction[] }) {
  return (
    <div className="flex items-center gap-0.5">
      {actions.map((a) => (
        <ActionButton key={a.label} editor={editor} action={a} />
      ))}
    </div>
  );
}

// Insert-image control: the button that opens the file picker plus the hidden
// input that uploads to S3 and inserts the node(s). Paste/drop is handled by the
// image extension; this is the discoverable button, shared by every surface with
// images on.
export function ImageInsertButton({ editor }: { editor: Editor }) {
  const imageInputRef = useRef<HTMLInputElement | null>(null);

  async function onPicked(files: FileList | null) {
    for (const file of Array.from(files ?? [])) {
      try {
        const src = await uploadEditorImage(file);
        editor.chain().focus().setImage({ src, alt: file.name.replace(/\.[^.]+$/, "") }).run();
      } catch (err) {
        console.error("[editor] image insert failed", err);
      }
    }
    if (imageInputRef.current) imageInputRef.current.value = "";
  }

  return (
    <>
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
        accept={IMAGE_UPLOAD_ACCEPT}
        multiple
        className="hidden"
        onChange={(e) => void onPicked(e.target.files)}
      />
    </>
  );
}

function LinkControls({ editor }: { editor: Editor }) {
  const dialog = useDialog();
  const linkActive = editor.isActive("link");
  return (
    <>
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
    </>
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

function HistoryGroup({ editor, history }: { editor: Editor; history?: ToolbarHistory }) {
  const hist: ToolbarHistory =
    history ?? {
      canUndo: () => editor.can().undo(),
      canRedo: () => editor.can().redo(),
      undo: () => editor.chain().focus().undo().run(),
      redo: () => editor.chain().focus().redo().run(),
    };
  return (
    <div className="flex items-center gap-0.5">
      <button
        type="button"
        title="Undo"
        aria-label="Undo"
        disabled={!hist.canUndo()}
        onMouseDown={(e) => {
          e.preventDefault();
          hist.undo();
        }}
        className="rounded p-1.5 text-muted-foreground transition-colors hover:text-foreground hover:bg-muted disabled:opacity-40 disabled:pointer-events-none"
      >
        <Undo2 size={15} />
      </button>
      <button
        type="button"
        title="Redo"
        aria-label="Redo"
        disabled={!hist.canRedo()}
        onMouseDown={(e) => {
          e.preventDefault();
          hist.redo();
        }}
        className="rounded p-1.5 text-muted-foreground transition-colors hover:text-foreground hover:bg-muted disabled:opacity-40 disabled:pointer-events-none"
      >
        <Redo2 size={15} />
      </button>
    </div>
  );
}

function signingRolesOf(features: EditorFeatures): string[] | null {
  const s = features.signing;
  if (!s) return null;
  const roles = s === true ? [] : s.roles ?? [];
  return roles.length > 0 ? roles : null;
}

export function EditorToolbar({
  editor,
  features,
  density = "full",
  history,
  extraFormatControls,
  trailing,
}: {
  editor: Editor;
  features: EditorFeatures;
  density?: ToolbarDensity;
  // Collab passes its Yjs-backed history; omitted → native editor undo/redo.
  history?: ToolbarHistory;
  // Collab slot: color / highlight / line-spacing / toggle controls, rendered
  // inline with the format groups so both editors read as one toolbar.
  extraFormatControls?: ReactNode;
  // Collab slot: right-aligned controls (version history).
  trailing?: ReactNode;
}) {
  // Tiptap doesn't re-render React on its own; tick on every transaction so
  // active/disabled states track the selection and history enable-state.
  const [, setTick] = useState(0);
  const [crop, setCrop] = useState<{
    src: string;
    pos: number;
    attrs: Record<string, unknown>;
  } | null>(null);
  useEffect(() => {
    const rerender = () => setTick((t) => t + 1);
    editor.on("transaction", rerender);
    editor.on("selectionUpdate", rerender);
    return () => {
      editor.off("transaction", rerender);
      editor.off("selectionUpdate", rerender);
    };
  }, [editor]);

  const imagesOn = !!features.images;
  const signingRoles = signingRolesOf(features);
  const hasLink = !!editor.schema.marks.link;

  // Open the crop modal for the currently-selected image node.
  function openCrop() {
    const { selection } = editor.state;
    if (
      selection instanceof NodeSelection &&
      selection.node.type.name === "image" &&
      typeof selection.node.attrs.src === "string"
    ) {
      setCrop({
        src: selection.node.attrs.src,
        pos: selection.from,
        attrs: { ...selection.node.attrs },
      });
    }
  }

  // Re-upload the cropped image and swap the node's src (resetting width, since
  // the dimensions changed). Throwing leaves the modal open to show the error.
  async function applyCrop(file: File) {
    if (!crop) return;
    const url = await uploadEditorImage(file);
    editor.view.dispatch(
      editor.view.state.tr.setNodeMarkup(crop.pos, undefined, {
        ...crop.attrs,
        src: url,
        width: null,
      }),
    );
    setCrop(null);
  }

  // Compact density (short one-line fields): selection-only link controls plus a
  // persistent image button when images are on. Nothing to show otherwise.
  if (density === "compact") {
    const { from, to } = editor.state.selection;
    const hasSelection = from !== to;
    const showLink = hasLink && (hasSelection || editor.isActive("link"));
    if (!showLink && !imagesOn) return null;
    return (
      <div className="flex flex-wrap items-center gap-0.5 border-b border-gray-200 px-2 py-1">
        {showLink && <LinkControls editor={editor} />}
        {imagesOn && <ImageInsertButton editor={editor} />}
      </div>
    );
  }

  const main = (
    <div className="flex flex-wrap items-center gap-0.5">
      <HistoryGroup editor={editor} history={history} />
      <Divider />
      <ActionGroup editor={editor} actions={MARK_ACTIONS} />
      <Divider />
      <ActionGroup editor={editor} actions={HEADING_ACTIONS} />
      <Divider />
      <ActionGroup editor={editor} actions={LIST_ACTIONS} />
      {imagesOn && (
        <>
          <Divider />
          <ActionGroup editor={editor} actions={IMAGE_ALIGN_ACTIONS} />
          <button
            type="button"
            title="Crop image"
            aria-label="Crop image"
            disabled={!editor.isActive("image")}
            onMouseDown={(e) => {
              e.preventDefault();
              openCrop();
            }}
            className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40 disabled:pointer-events-none"
          >
            <Crop size={15} />
          </button>
        </>
      )}
      {extraFormatControls && (
        <>
          <Divider />
          {extraFormatControls}
        </>
      )}
      {hasLink && (
        <>
          <Divider />
          <LinkControls editor={editor} />
        </>
      )}
      {imagesOn && (
        <>
          <Divider />
          <ImageInsertButton editor={editor} />
        </>
      )}
      {signingRoles && (
        <>
          <Divider />
          <SigningInsertControls editor={editor} roles={signingRoles} />
        </>
      )}
    </div>
  );

  return (
    <>
      <div className="flex items-center justify-between gap-1 border-b border-border px-1.5 py-1">
        {main}
        {trailing && <div className="flex-shrink-0">{trailing}</div>}
      </div>
      {crop && (
        <ImageCropModal
          src={crop.src}
          onApply={applyCrop}
          onCancel={() => setCrop(null)}
        />
      )}
    </>
  );
}
