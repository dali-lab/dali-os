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
import { Tooltip } from "~/components/ui/floating";
import { useOsChrome } from "~/components/os-chrome";

export function EditableSection({
  title,
  icon,
  description,
  canEdit,
  children,
  onSave,
  className,
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
  /** Overrides the section's own dress. Left unset, the section wears the
   *  shell's default — a bordered card on the brand shell, a bare title over
   *  its content under dali.os. */
  className?: string;
}) {
  const { os, sectionShell, sectionTitle } = useOsChrome();
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
    <section className={className ?? sectionShell}>
      <div className="flex items-start justify-between gap-2">
        <div>
          {/* The os design titles a section in plain text — the glyph belongs
              to its eyebrow-labelled settings panels, not here. */}
          <h2
            className={
              os
                ? sectionTitle
                : icon
                  ? "inline-flex items-center gap-2 font-heading font-semibold text-foreground"
                  : "text-sm font-semibold text-foreground"
            }
          >
            {!os && icon}
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
                {/* The os design labels its buttons — a bare glyph pair reads
                    as toolbar chrome next to a 19px section title. */}
                <Tooltip content="Cancel" disabled={os}>
                  <button
                    type="button"
                    onClick={cancel}
                    disabled={busy}
                    aria-label="Cancel"
                    className={
                      os
                        ? "inline-flex items-center rounded-full px-3.5 py-1.5 text-[13px] font-semibold text-os-grey transition-colors hover:bg-os-container hover:text-foreground disabled:opacity-60"
                        : "inline-flex items-center justify-center p-1.5 rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors disabled:opacity-60"
                    }
                  >
                    {os ? "Cancel" : <X className="w-3.5 h-3.5" />}
                  </button>
                </Tooltip>
                <Tooltip content="Save changes" disabled={os}>
                  <button
                    type="button"
                    onClick={() => void save()}
                    disabled={busy}
                    aria-label="Save changes"
                    className={
                      os
                        ? "inline-flex items-center gap-1.5 rounded-full bg-os-accent px-4 py-1.5 text-[13px] font-semibold text-os-bg transition-colors hover:bg-os-accent-hover disabled:opacity-60"
                        : "inline-flex items-center justify-center p-1.5 rounded-md bg-accent-coral text-white hover:bg-accent-coral/90 transition-colors disabled:opacity-60"
                    }
                  >
                    {busy ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : os ? (
                      "Save"
                    ) : (
                      <Check className="w-3.5 h-3.5" />
                    )}
                  </button>
                </Tooltip>
              </>
            ) : (
              <Tooltip content={`Edit ${title}`} disabled={os}>
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  aria-label={`Edit ${title}`}
                  className={
                    os
                      ? "inline-flex items-center gap-1.5 rounded-full border border-os-container px-3.5 py-1.5 text-[13px] font-semibold text-os-grey transition-colors hover:border-os-container-hi hover:text-foreground"
                      : "inline-flex items-center justify-center p-1.5 rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
                  }
                >
                  <Pencil className="w-3.5 h-3.5" />
                  {os && "Edit"}
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
