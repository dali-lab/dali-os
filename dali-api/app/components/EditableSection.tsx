// Reusable "section with its own edit toggle" wrapper. Wraps a section
// header + body; the body gets a render-prop `editing` flag so it can swap
// between read-only and input rendering. Save/Cancel buttons appear in
// edit mode; the pencil button appears in read-only mode.
//
// Cancel reverts the form's inputs by remounting the body (a bumped key
// resets <input defaultValue> back to the initial value). Save submits the
// surrounding <Form> via useSubmit and then leaves edit mode once the
// action redirects and the loader returns fresh defaults.
//
// Pages compose this around their existing per-intent forms: the body
// renders the same fields it did before, the only change is that the
// fields are inputs when `editing` and read-only spans otherwise. No
// changes are required to the route's action handlers.

import { useState, type ReactNode } from "react";
import { Check, Loader2, Pencil, X } from "lucide-react";
import { Tooltip } from "~/components/ui/IconButton";

export function EditableSection({
  title,
  icon,
  description,
  canEdit,
  children,
  onSave,
  className = "bg-card border border-border rounded-lg p-4 flex flex-col gap-3",
}: {
  title: string;
  /** Optional icon rendered before the title. Use a Lucide icon node sized
   *  to match the other section headers (`w-4 h-4`). */
  icon?: ReactNode;
  description?: string;
  /** Loader-determined permission. When false, no Edit button appears. */
  canEdit: boolean;
  /** Render-prop body. `editing` is true only when the section is in edit
   *  mode AND the user has permission. */
  children: (state: {
    editing: boolean;
    /** Stable per-edit-cycle id — use on a wrapping <div key={resetKey}> to
     *  force defaultValue inputs back to their initial values when Cancel
     *  is pressed. */
    resetKey: number;
  }) => ReactNode;
  /** Called when Save is clicked. The page should submit the section's
   *  existing form; this just closes the section. If `onSave` returns a
   *  promise the button shows a pending state until it resolves. */
  onSave: () => void | Promise<void>;
  className?: string;
}) {
  const [editing, setEditing] = useState(false);
  // Bumped on Cancel so child inputs (which read defaultValue) remount and
  // pick up the original values again instead of keeping the user's typing.
  const [resetKey, setResetKey] = useState(0);
  const [busy, setBusy] = useState(false);

  function cancel() {
    setResetKey((k) => k + 1);
    setEditing(false);
  }

  async function save() {
    setBusy(true);
    try {
      await Promise.resolve(onSave());
      setEditing(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={className}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2
            className={
              icon
                ? "inline-flex items-center gap-2 font-heading font-semibold text-foreground"
                : "text-sm font-semibold text-foreground"
            }
          >
            {icon}
            {title}
          </h2>
          {description && (
            <p className="text-xs text-muted-foreground mt-0.5">
              {description}
            </p>
          )}
        </div>
        {canEdit && (
          <div className="flex items-center gap-1.5 shrink-0">
            {editing ? (
              <>
                <Tooltip label="Cancel">
                  <button
                    type="button"
                    onClick={cancel}
                    disabled={busy}
                    aria-label="Cancel"
                    className="inline-flex items-center justify-center p-1.5 rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors disabled:opacity-60"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </Tooltip>
                <Tooltip label="Save changes">
                  <button
                    type="button"
                    onClick={() => void save()}
                    disabled={busy}
                    aria-label="Save changes"
                    className="inline-flex items-center justify-center p-1.5 rounded-md bg-accent-coral text-white hover:bg-accent-coral/90 transition-colors disabled:opacity-60"
                  >
                    {busy ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Check className="w-3.5 h-3.5" />
                    )}
                  </button>
                </Tooltip>
              </>
            ) : (
              <Tooltip label={`Edit ${title}`}>
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  aria-label={`Edit ${title}`}
                  className="inline-flex items-center justify-center p-1.5 rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
              </Tooltip>
            )}
          </div>
        )}
      </div>

      <div key={resetKey}>{children({ editing: editing && canEdit, resetKey })}</div>
    </section>
  );
}
