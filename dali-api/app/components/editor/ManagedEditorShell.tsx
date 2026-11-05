// ManagedEditorShell — reusable chrome for Drive's "managed" (versioned)
// editors: agreements, rubrics (future), and any surface that has an immutable
// version history alongside a live collab working draft.
//
// What it provides:
//   • Page-bar slots: status, actions, overflow rows and click-to-rename on the title crumb
//   • Version sidebar slot: scrollable version list with "New version" button
//   • "Restore this version" affordance: seeds the collab room from a past version
//   • Unsaved-changes guard: warns before leaving while a "new version" draft
//     is in progress (collab autosave covers the working draft; this guard is
//     for the explicit "Save Version" workflow gate)
//
// Styled with os tokens (os-accent, muted, card, border).

import {
  type ReactNode,
  useEffect,
} from "react";
import { useSubmit } from "react-router";
import { RotateCcw } from "lucide-react";
import { useDialog } from "~/components/ui/dialog";
import { PageBarMenuItems, PageBarPortal, PageBarTitle } from "~/components/shell/page-bar-slot";

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

// ─── Rename ──────────────────────────────────────────────────────────────────

interface RenameProps {
  name: string;
  /** Called with the new name; parent is responsible for committing it. */
  onRename?: (name: string) => void;
  /** Posts `{ intent, name }` to the route's action when set. */
  renameIntent?: string;
  /** Error from action data to show above the body. */
  renameError?: string;
}

function RenameRegistration({ name, onRename, renameIntent }: RenameProps) {
  const submit = useSubmit();
  return (
    <PageBarTitle
      title={name}
      onRename={(next) => {
        onRename?.(next);
        if (renameIntent) submit({ intent: renameIntent, name: next }, { method: "post" });
      }}
    />
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
      className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-os-accent disabled:opacity-40"
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
  /** Page-bar status after the title crumb, e.g. "v4 · In force". */
  status?: ReactNode;
  /** Page-bar buttons: type buttons first, then the one filled primary. */
  headerActions?: ReactNode;
  /** Extra rows for the page bar's overflow menu, after Rename. */
  menuItems?: ReactNode;
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
  status,
  headerActions,
  menuItems,
  versionSidebar,
  children,
  isDrafting = false,
  footer,
}: ManagedEditorShellProps) {
  // Wire the beforeunload guard so navigating away while drafting prompts.
  useUnsavedGuard(isDrafting);

  return (
    <div className="space-y-6">
      {(status || saveState) && (
        <PageBarPortal slot="status">
          <span className="flex items-center gap-2 text-[13px] text-os-muted">
            {status}
            {saveState && <SaveStateBadge state={saveState} />}
          </span>
        </PageBarPortal>
      )}
      {headerActions && <PageBarPortal slot="actions">{headerActions}</PageBarPortal>}
      {rename && <RenameRegistration {...rename} name={rename.name ?? name} />}
      {menuItems && <PageBarMenuItems>{menuItems}</PageBarMenuItems>}
      {rename?.renameError && <p className="text-sm text-destructive">{rename.renameError}</p>}
      {metaBadges && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">{metaBadges}</div>
      )}

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
