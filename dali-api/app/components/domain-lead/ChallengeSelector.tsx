import { useState } from "react";
import { Form } from "react-router";

export function ChallengeSelector({ cycleId, domainId, options, selectedId }: {
  cycleId: string;
  domainId: string;
  options: any[];
  selectedId: string | null;
}) {
  const [previewId, setPreviewId] = useState<string>(selectedId ?? "");
  const previewVersion = options.find((cv: any) => cv.id === previewId);
  const questions: any[] = previewVersion?.questions ?? [];

  return (
    <div className="space-y-3 pt-1">
      <Form method="post" className="flex items-end gap-3">
        <input type="hidden" name="intent" value="select-challenge" />
        <input type="hidden" name="cycleId" value={cycleId} />
        <input type="hidden" name="domainId" value={domainId} />
        <div className="flex-1">
          <label className="block text-sm font-medium text-foreground/80 mb-1">
            Challenge
          </label>
          <select
            name="challengeVersionId"
            value={previewId}
            onChange={(e) => setPreviewId(e.target.value)}
            className="w-full px-3 py-2 text-sm text-foreground border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="" disabled>Select a challenge…</option>
            {options.map((cv: any) => (
              <option key={cv.id} value={cv.id}>
                {cv.challenge.name} (v{cv.id.slice(-4)})
              </option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          disabled={!previewId}
          className="px-3 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Save
        </button>
      </Form>

      {questions.length > 0 && (
        <div className="border border-border rounded-md divide-y divide-gray-100">
          {questions.map((q: any, i: number) => (
            <div key={q.key} className="px-4 py-3">
              <span className="text-xs font-medium text-muted-foreground/70 uppercase tracking-wide mr-2">Q{i + 1}</span>
              <span className="text-sm text-foreground/80">{q.data.label}</span>
              {q.required && <span className="ml-2 text-xs text-red-500">required</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
