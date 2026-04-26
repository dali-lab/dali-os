import { Form } from "react-router";
import { CheckCircle, AlertTriangle, Plus, Trash2 } from "lucide-react";
import { GeneralFormPicker } from "./GeneralFormPicker";
import { GeneralRubricPicker } from "./GeneralRubricPicker";

export function CycleSetupTab({ cycle, cycleStatus, loaderData }: {
  cycle: any;
  cycleStatus: string;
  loaderData: any;
}) {
  return (
    <div className="space-y-6">
      {/* Close Date */}
      <div className="bg-card rounded-xl border border-border shadow-sm p-6">
        <h3 className="text-sm font-bold text-foreground/80 mb-3">Application Close Date</h3>
        <Form method="post" className="flex items-end gap-3">
          <input type="hidden" name="intent" value="set-close-date" />
          <div className="flex-1">
            <input
              type="date"
              name="closeDate"
              defaultValue={cycle?.closeDate ? new Date(cycle.closeDate).toISOString().slice(0, 10) : ''}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <button
            type="submit"
            className="px-4 py-2 text-sm font-medium rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition"
          >
            Save
          </button>
        </Form>
      </div>

      {/* Domains */}
      <div className="bg-card rounded-xl border border-border shadow-sm p-6 space-y-4">
        <h3 className="text-sm font-bold text-foreground/80">Domains in this Cycle</h3>
        {(cycle?.domains ?? []).length > 0 ? (
          <div className="divide-y divide-border">
            {(cycle?.domains ?? []).map((d: any) => {
              const hasChallengeVersion = (cycle?.challengeVersions ?? []).some(
                (cv: any) => cv.challengeVersion?.domainId === d.domainId
              );
              return (
                <div key={d.domainId} className="flex items-center justify-between py-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-foreground">{d.domain?.name ?? d.domainId}</span>
                    {hasChallengeVersion ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-green-100 text-green-700">
                        <CheckCircle className="w-3 h-3" /> Challenge linked
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-yellow-100 text-yellow-700">
                        <AlertTriangle className="w-3 h-3" /> No challenge
                      </span>
                    )}
                  </div>
                  {cycleStatus === 'Draft' && (
                    <Form method="post">
                      <input type="hidden" name="intent" value="remove-domain" />
                      <input type="hidden" name="domainId" value={d.domainId} />
                      <button type="submit" className="text-red-500 hover:text-red-700 transition">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </Form>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground/70">No domains added yet.</p>
        )}
        {cycleStatus === 'Draft' && (
          <Form method="post" className="flex items-end gap-3 pt-2 border-t border-border">
            <input type="hidden" name="intent" value="add-domain" />
            <div className="flex-1">
              <label className="block text-xs font-medium text-muted-foreground mb-1">Add Domain</label>
              <select
                name="domainId"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                defaultValue=""
              >
                <option value="" disabled>Select domain...</option>
                {(loaderData?.allDomains ?? [])
                  .filter((d: any) => !(cycle?.domains ?? []).some((cd: any) => cd.domainId === d.id))
                  .map((d: any) => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
              </select>
            </div>
            <button
              type="submit"
              className="flex items-center gap-1 px-4 py-2 text-sm font-medium rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition"
            >
              <Plus className="w-4 h-4" /> Add
            </button>
          </Form>
        )}
      </div>

      {/* General Form picker */}
      <GeneralFormPicker
        currentCvId={(() => {
          const generalCv = (cycle?.challengeVersions ?? []).find((cv: any) => cv.challengeVersion?.domainId === null);
          return generalCv?.challengeVersionId ?? null;
        })()}
        currentCvName={(() => {
          const generalCv = (cycle?.challengeVersions ?? []).find((cv: any) => cv.challengeVersion?.domainId === null);
          return generalCv ? `${generalCv.challengeVersion?.challenge?.name ?? 'Untitled'} (${(generalCv.challengeVersion?.questions as any[])?.length ?? 0} questions)` : null;
        })()}
        options={loaderData?.generalChallengeVersions ?? []}
        locked={cycleStatus !== 'Draft'}
      />

      {/* General Form Rubric */}
      <GeneralRubricPicker
        currentRubricVersionId={cycle?.generalRubricVersionId}
        rubricVersionOptions={loaderData?.rubricVersionOptions ?? []}
        locked={(loaderData?.cycleApplicationReviewCount ?? 0) > 0}
      />
    </div>
  );
}
