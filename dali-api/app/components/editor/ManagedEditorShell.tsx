// ManagedEditorShell — reusable chrome for Drive's "managed" (versioned)
// editors: agreements, rubrics (future), and any surface that has an immutable
// version history alongside a live collab working draft.
//
// What it provides:
//   • Header slot: inline rename form + save-state badge (autosaved / saving…)
//   • Version sidebar slot: scrollable version list with "New version" button
//   • "Restore this version" affordance: seeds the collab room from a past version
//   • Unsaved-changes guard: warns before leaving while a "new version" draft
//     is in progress (collab autosave covers the working draft; this guard is
//     for the explicit "Save Version" workflow gate)
//
// Styled with DALI tokens (accent-coral, muted, card, border). No blue.
//
// Usage:
//   <ManagedEditorShell
//     name={document.name}
//     onRename={(name) => submit({ intent: "rename", name })}
//     isDrafting={isCreating}
//     versionSidebar={<VersionList versions={...} />}
//     headerActions={<ArchiveButton />}
//   >
//     {/* editor body + insert controls */}
//   </ManagedEditorShell>

import {
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import { Form } from "react-router";
import { Pencil, RotateCcw } from "lucide-react";
import { useDialog } from "~/components/ui/dialog";

// ─── Save-state indicator ────────────────────────────────────────────────────

export type SaveState = "idle" | "saving" | "saved" | "error";

function SaveStateBadge({ state }: { state: SaveState }) {
  if (state === "idle") return null;
  const label =
    state === "saving" ? "Saving…"
    : state === "saved" ? "Autosaved"
    : "Save error";
  const cls =
    state === "saving" ? "text-muted-foreground"
    : state === "saved" ? "text-green-600"
    : "text-red-600";
  return (
    <span className={`text-xs font-medium ${cls} transition-colors`}>
      {label}
    </span>
  );
}

// ─── Inline rename ───────────────────────────────────────────────────────────

interface RenameProps {
  name: string;
  /** Called with the new name; parent is responsible for the Form submit. */
  onRename?: (name: string) => void;
  /** When provided, wraps the rename form in a React Router <Form> posting this intent. */
  renameIntent?: string;
  /** Error from action data to show under the rename field. */
  renameError?: string;
}

function InlineRename({
  name: initialName,
  onRename,
  renameIntent,
  renameError,
}: RenameProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(initialName);

  // Keep draft in sync when the parent commits a rename (action redirect).
  const prevName = useRef(initialName);
  if (prevName.current !== initialName) {
    prevName.current = initialName;
    setDraft(initialName);
  }

  if (editing) {
    // Notify the parent of the new name and leave edit mode. In the <Form> path
    // this MUST run from the form's onSubmit — never from the Save button's
    // onClick. A discrete-event setState in the button's click handler flushes
    // synchronously and unmounts the <Form> before the browser dispatches the
    // submit, silently dropping the POST (this is why in-doc rename "did nothing").
    const commit = () => {
      onRename?.(draft);
      setEditing(false);
    };

    const fields = (isForm: boolean) => (
      <>
        <input
          type="text"
          name="name"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className="px-3 py-2 text-base border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-accent-coral/30 min-w-[18rem]"
          autoFocus
        />
        <button
          type={isForm ? "submit" : "button"}
          className="px-3 py-2 text-sm font-medium text-white bg-accent-coral rounded-md hover:bg-accent-coral/90"
          onClick={isForm ? undefined : commit}
        >
          Save
        </button>
        <button
          type="button"
          onClick={() => {
            setDraft(initialName);
            setEditing(false);
          }}
          className="px-3 py-2 text-sm font-medium text-foreground/80 bg-card border border-border rounded-md hover:bg-muted/50"
        >
          Cancel
        </button>
      </>
    );

    return (
      <div className="flex items-center gap-2">
        {renameIntent ? (
          <Form
            method="post"
            className="flex items-center gap-2"
            onSubmit={commit}
          >
            <input type="hidden" name="intent" value={renameIntent} />
            {fields(true)}
          </Form>
        ) : (
          <div className="flex items-center gap-2">{fields(false)}</div>
        )}
        {renameError && (
          <p className="mt-1 text-xs text-red-600">{renameError}</p>
        )}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3">
      <h1 className="text-2xl font-bold text-foreground">{initialName}</h1>
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="text-muted-foreground/70 hover:text-foreground"
        aria-label="Rename"
      >
        <Pencil className="w-4 h-4" />
      </button>
    </div>
  );
}

// ─── Restore affordance ──────────────────────────────────────────────────────

/** Drop-in "Restore this version" button for a version sidebar item.
 *  Calls onRestore which should seed the collab room from that version's body. */
export function RestoreVersionButton({
  onRestore,
  disabled,
}: {
  onRestore: () => void;
  disabled?: boolean;
}) {
  const dialog = useDialog();

  const handleClick = async () => {
    const ok = await dialog.confirm({
      title: "Restore this version?",
      description: "The working draft will be replaced with this version's content. This cannot be undone.",
      confirmLabel: "Restore",
      tone: "destructive",
    });
    if (ok) onRestore();
  };

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={handleClick}
      title="Restore this version into the working draft"
      className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-accent-coral disabled:opacity-40"
    >
      <RotateCcw className="w-3 h-3" />
      Restore
    </button>
  );
}

// ─── Unsaved-changes guard ───────────────────────────────────────────────────

/**
 * Hook that fires a browser beforeunload warning when `isDirty` is true.
 * In collab mode the Y.Doc autosaves continuously; this guard targets the
 * explicit "Save Version" workflow — warn before navigating away while
 * `isCreating` is true (a version is in progress but not yet saved).
 */
export function useUnsavedGuard(isDirty: boolean) {
  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);
}

// ─── Shell ───────────────────────────────────────────────────────────────────

export interface ManagedEditorShellProps {
  /** Document name displayed in the header. */
  name: string;
  /** Props forwarded to the inline rename sub-component. */
  rename?: RenameProps;
  /** Current save state (shown as a badge in the header). */
  saveState?: SaveState;
  /** Metadata badges rendered under the title (kind, scope, audience…). */
  metaBadges?: ReactNode;
  /** Action buttons rendered to the right of the title row (New Version, Archive…). */
  headerActions?: ReactNode;
  /** Full version sidebar — the caller owns version selection, listing, and restore. */
  versionSidebar?: ReactNode;
  /** Editor body + insert controls — rendered in the main column. */
  children: ReactNode;
  /** When true, the beforeunload guard fires to warn about unsaved version drafts. */
  isDrafting?: boolean;
  /** Additional bindings/info panel rendered below the editor section. */
  footer?: ReactNode;
}

export function ManagedEditorShell({
  name,
  rename,
  saveState,
  metaBadges,
  headerActions,
  versionSidebar,
  children,
  isDrafting = false,
  footer,
}: ManagedEditorShellProps) {
  // Wire the beforeunload guard so navigating away while drafting prompts.
  useUnsavedGuard(isDrafting);

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          {rename ? (
            <InlineRename {...rename} name={rename.name ?? name} />
          ) : (
            <h1 className="text-2xl font-bold text-foreground">{name}</h1>
          )}
          {metaBadges && (
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              {metaBadges}
            </div>
          )}
          {saveState && (
            <div className="mt-0.5">
              <SaveStateBadge state={saveState} />
            </div>
          )}
        </div>
        {headerActions && (
          <div className="flex items-center gap-2 shrink-0">{headerActions}</div>
        )}
      </div>

      {/* ── Body: version sidebar + editor ── */}
      <div className="grid grid-cols-1 lg:grid-cols-[16rem_1fr] gap-6">
        {versionSidebar && (
          <aside className="space-y-2">{versionSidebar}</aside>
        )}
        <section className="space-y-6">{children}</section>
      </div>

      {/* ── Footer (bindings, in-force info, etc.) ── */}
      {footer}
    </div>
  );
}
