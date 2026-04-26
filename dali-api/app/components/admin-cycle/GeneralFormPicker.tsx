import { useState } from "react";
import { Form } from "react-router";
import { CheckCircle } from "lucide-react";

export function GeneralFormPicker({ currentCvId, currentCvName, options, locked }: {
  currentCvId: string | null;
  currentCvName: string | null;
  options: any[];
  locked: boolean;
}) {
  const [editing, setEditing] = useState(!currentCvId);

  return (
    <div className="bg-card rounded-xl border border-border shadow-sm p-6 space-y-3">
      <h3 className="text-sm font-bold text-foreground/80">General Application Form</h3>

      {locked ? (
        currentCvId ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <CheckCircle className="w-4 h-4 text-green-600" />
            <span>{currentCvName}</span>
            <span className="text-xs text-muted-foreground/70 ml-2">(locked — cycle is past Draft)</span>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground/70">No general form linked.</p>
        )
      ) : currentCvId && !editing ? (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <CheckCircle className="w-4 h-4 text-green-600" />
            <span>{currentCvName}</span>
          </div>
          <button
            onClick={() => setEditing(true)}
            className="text-xs text-blue-600 hover:text-blue-800 font-medium"
          >
            Change
          </button>
        </div>
      ) : options.length > 0 ? (
        <Form method="post" className="flex items-end gap-3" onSubmit={() => setEditing(false)}>
          <input type="hidden" name="intent" value="link-general-form" />
          <div className="flex-1">
            <select
              name="challengeVersionId"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              defaultValue={currentCvId ?? ""}
            >
              <option value="" disabled>Select a general form...</option>
              {options.map((cv: any) => (
                <option key={cv.id} value={cv.id}>
                  {cv.challenge?.name ?? 'Untitled'} ({(cv.questions as any[])?.length ?? 0} questions)
                </option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            className="px-4 py-2 text-sm font-medium rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition"
          >
            Save
          </button>
          {currentCvId && (
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground"
            >
              Cancel
            </button>
          )}
        </Form>
      ) : (
        <p className="text-xs text-muted-foreground/70">No general forms available. Create a challenge with no domain on the Challenges page first.</p>
      )}
    </div>
  );
}
