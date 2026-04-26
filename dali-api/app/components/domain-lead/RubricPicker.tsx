import { Form } from "react-router";
import { CheckCircle } from "lucide-react";

export function RubricPicker({ cycleId, domainId, options, selectedId, locked }: {
  cycleId: string;
  domainId: string;
  options: any[];
  selectedId: string | null;
  locked: boolean;
}) {
  const selectedLabel = options.find((rv: any) => rv.id === selectedId);
  return (
    <div className="bg-card border border-border rounded-lg overflow-hidden">
      <div className="px-6 py-4 border-b border-border bg-muted/50">
        <h3 className="font-semibold text-foreground">Domain Rubric</h3>
      </div>
      <div className="p-4">
        {locked ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <CheckCircle className="w-4 h-4 text-green-600" />
            <span>{selectedLabel ? `${selectedLabel.rubric.name} — v${selectedLabel.versionNumber}` : 'Set'}</span>
            <span className="text-xs text-muted-foreground/70 ml-2">(locked — reviewers have been assigned)</span>
          </div>
        ) : (
          <Form method="post" key={`rubric-${selectedId}`} className="flex items-end gap-3">
            <input type="hidden" name="intent" value="set-rubric" />
            <input type="hidden" name="cycleId" value={cycleId} />
            <input type="hidden" name="domainId" value={domainId} />
            <div className="flex-1">
              <label className="block text-xs font-medium text-muted-foreground mb-1">Rubric Version</label>
              <select
                name="rubricVersionId"
                defaultValue={selectedId ?? ""}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              >
                <option value="">No rubric assigned</option>
                {options.map((rv: any) => (
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
          </Form>
        )}
      </div>
    </div>
  );
}
