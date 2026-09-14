import type { ReactNode } from "react";
import { Select } from "~/components/ui/floating";
import { Toggle } from "~/components/ui/Toggle";
import { cn } from "~/lib/cn";

// The one timesheet block shared by the Create Event modal and the edit
// composer, so "log this event's hours" reads and behaves identically in both.
// It is purely presentational: the parent owns the role-key ENCODING (the two
// surfaces historically encode it differently) and the hidden inputs / payload
// that actually submit — this component only renders the toggle, role picker
// and work note, all controlled via props.
export function TimesheetFields({
  isWork,
  onIsWorkChange,
  roleKey,
  onRoleKeyChange,
  roleOptions,
  workNote,
  onWorkNoteChange,
  description,
  fieldClass,
  className,
}: {
  isWork: boolean;
  onIsWorkChange: (next: boolean) => void;
  roleKey: string;
  onRoleKeyChange: (next: string) => void;
  /** Already mapped to the caller's own role-key encoding. */
  roleOptions: { value: string; label: string }[];
  workNote: string;
  onWorkNoteChange: (next: string) => void;
  /** Context-specific helper under the toggle (create vs edit vs repeating). */
  description: ReactNode;
  /** The host modal's field styling, so the inputs match their container. */
  fieldClass: string;
  className?: string;
}) {
  return (
    <div className={cn("rounded-md border border-border bg-muted/20 p-3", className)}>
      <Toggle
        checked={isWork}
        onChange={(e) => onIsWorkChange(e.target.checked)}
        label="Add to timesheet"
        description={description}
      />
      {isWork && (
        <div className="mt-3 space-y-3">
          <div>
            <p className="mb-1.5 text-xs font-medium text-muted-foreground">Role</p>
            <Select
              value={roleKey}
              onChange={onRoleKeyChange}
              placeholder="Pick a role…"
              options={roleOptions}
              buttonClassName={cn(fieldClass, "inline-flex w-full items-center justify-between gap-1")}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              What did you work on? <span className="text-red-500">*</span>
            </label>
            <textarea
              value={workNote}
              onChange={(e) => onWorkNoteChange(e.target.value)}
              placeholder="Briefly describe what you worked on…"
              rows={2}
              className={cn(fieldClass, "resize-y")}
            />
          </div>
        </div>
      )}
    </div>
  );
}
