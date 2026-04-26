import { useState } from "react";
import { Form } from "react-router";
import { CheckCircle } from "lucide-react";

export function GeneralRubricPicker({ currentRubricVersionId, rubricVersionOptions, locked }: {
  currentRubricVersionId: string | null;
  rubricVersionOptions: any[];
  locked: boolean;
}) {
  const [editing, setEditing] = useState(!currentRubricVersionId);
  const currentRubric = rubricVersionOptions.find((rv: any) => rv.id === currentRubricVersionId);

  return (
    <div className="bg-card rounded-xl border border-border shadow-sm p-6 space-y-3">
      <h3 className="text-sm font-bold text-foreground/80">General Application Rubric</h3>
      <p className="text-xs text-muted-foreground">Reviewers score every application against this rubric (in addition to the per-domain rubric set by domain leads).</p>

      {locked ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <CheckCircle className="w-4 h-4 text-green-600" />
          <span>{currentRubric?.rubric?.name ?? 'Set'} — v{currentRubric?.versionNumber}</span>
          <span className="text-xs text-muted-foreground/70 ml-2">(locked — reviews have started)</span>
        </div>
      ) : currentRubricVersionId && !editing ? (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <CheckCircle className="w-4 h-4 text-green-600" />
            <span>{currentRubric?.rubric?.name ?? 'Set'} — v{currentRubric?.versionNumber}</span>
          </div>
          <button
            onClick={() => setEditing(true)}
            className="text-xs text-blue-600 hover:text-blue-800 font-medium"
          >
            Change
          </button>
        </div>
      ) : (
        <Form method="post" className="flex items-end gap-3" onSubmit={() => setEditing(false)}>
          <input type="hidden" name="intent" value="set-general-rubric" />
          <div className="flex-1">
            <select
              name="rubricVersionId"
              defaultValue={currentRubricVersionId ?? ""}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            >
              <option value="">No rubric assigned</option>
              {rubricVersionOptions.map((rv: any) => (
                <option key={rv.id} value={rv.id}>
                  {rv.rubric.name} — v{rv.versionNumber}
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
          {currentRubricVersionId && (
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground"
            >
              Cancel
            </button>
          )}
        </Form>
      )}
    </div>
  );
}
