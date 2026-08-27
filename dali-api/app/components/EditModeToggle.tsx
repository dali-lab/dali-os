import { useState } from "react";
import { Check, Pencil } from "lucide-react";
import { Tooltip } from "~/components/ui/floating";

/**
 * Page-level view/edit gate. `canEdit` is the loader-determined permission;
 * the returned `editing` flag is what UI should actually key off — it's only
 * true when the user both has permission AND has opted into edit mode.
 *
 * Defaults to view every visit (plain local state, no persistence) so a page
 * never lands in edit mode unprompted, even for users who can edit.
 */
export function useEditMode(canEdit: boolean): {
  editing: boolean;
  editMode: boolean;
  setEditMode: (next: boolean) => void;
} {
  const [editMode, setEditMode] = useState(false);
  return { editing: canEdit && editMode, editMode, setEditMode };
}

/**
 * Header control shown where the "Read-only" badge used to be. Users without
 * edit permission still see "Read-only"; users with permission get an
 * Edit / Done button.
 */
export function EditModeToggle({
  canEdit,
  editMode,
  setEditMode,
}: {
  canEdit: boolean;
  editMode: boolean;
  setEditMode: (next: boolean) => void;
}) {
  if (!canEdit) {
    return <span className="text-xs text-muted-foreground">Read-only</span>;
  }

  return (
    <Tooltip content={editMode ? "Done editing" : "Edit"}>
      <button
        type="button"
        onClick={() => setEditMode(!editMode)}
        aria-pressed={editMode}
        aria-label={editMode ? "Done editing" : "Edit"}
        className={`inline-flex items-center justify-center p-1.5 rounded-md border transition-colors ${
          editMode
            ? "bg-accent-coral text-white border-transparent hover:bg-accent-coral/90"
            : "border-border text-muted-foreground hover:bg-muted hover:text-foreground"
        }`}
      >
        {editMode ? <Check className="w-3.5 h-3.5" /> : <Pencil className="w-3.5 h-3.5" />}
      </button>
    </Tooltip>
  );
}
