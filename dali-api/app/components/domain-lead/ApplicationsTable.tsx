import { useState } from "react";
import { Link } from "react-router";
import { DecisionBadge, StatusBadge } from "./primitives";
import { ReviewerAssignmentCell } from "./ReviewerAssignmentCell";

export function ApplicationsTable({ apps, draftDecisions, cycleReviewersForDomain, cycleId, domainId, currentStatus, canAssignReviewers, rubricCriteria }: {
  apps: any[];
  draftDecisions: any[];
  cycleReviewersForDomain: any[];
  cycleId: string;
  domainId: string;
  currentStatus: string;
  canAssignReviewers: boolean;
  rubricCriteria: any[];
}) {
  const isUnderReview = currentStatus === "UnderReview";
  const [filter, setFilter] = useState<"all" | "finalize">("all");

  const draftDecisionAppIds = new Set(
    draftDecisions
      .filter((d: any) => {
        const da = apps.flatMap((a: any) => a.domainApplications).find((da: any) => da?.id === d.domainApplicationId);
        if (!da) return false;
        const hasFinal = (da.decisions ?? []).some((dec: any) => dec.stage === "Final");
        return !hasFinal;
      })
      .map((d: any) => {
        const da = apps.flatMap((a: any) => a.domainApplications).find((da: any) => da?.id === d.domainApplicationId);
        return da?.applicationId;
      })
      .filter(Boolean),
  );

  const finalizableApps = apps.filter((app: any) => {
    const da = app.domainApplications[0];
    if (!da) return false;
    const decisions = da.decisions ?? [];
    const latestDraft = decisions.find((d: any) => d.stage === "Draft");
    const latestFinal = decisions.find((d: any) => d.stage === "Final");
    return latestDraft && !latestFinal;
  });

  const displayedApps = filter === "finalize" ? finalizableApps : apps;

  return (
    <div className="bg-card border border-border rounded-lg overflow-hidden">
      <div className="px-6 py-4 border-b border-border bg-muted/50 flex items-center justify-between">
        <div className="flex items-center gap-1">
          {isUnderReview ? (
            <div className="flex items-center gap-1 bg-muted rounded-lg p-0.5">
              <button
                onClick={() => setFilter("all")}
                className={`px-3 py-1 text-xs font-medium rounded-md transition ${
                  filter === "all" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground/80"
                }`}
              >
                All Applicants ({apps.length})
              </button>
              <button
                onClick={() => setFilter("finalize")}
                className={`px-3 py-1 text-xs font-medium rounded-md transition ${
                  filter === "finalize" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground/80"
                }`}
              >
                Needs Finalization ({finalizableApps.length})
              </button>
            </div>
          ) : (
            <h3 className="font-semibold text-foreground">Applications ({apps.length})</h3>
          )}
        </div>
        <div className="flex items-center gap-2">
          {isUnderReview && filter === "finalize" && finalizableApps.length > 0 && (
            <button
              onClick={async () => {
                for (const app of finalizableApps) {
                  const da = app.domainApplications[0];
                  const draft = (da?.decisions ?? []).find((d: any) => d.stage === "Draft");
                  if (draft) {
                    await fetch(`/api/decisions/${draft.id}/finalize`, { method: "POST", credentials: "include" });
                  }
                }
                window.location.reload();
              }}
              className="px-3 py-1.5 text-xs font-medium rounded-lg bg-green-600 hover:bg-green-700 text-white transition"
            >
              Finalize All ({finalizableApps.length})
            </button>
          )}
          {currentStatus === "UnderReview" && (
            <button
              onClick={async () => {
                const res = await fetch(`/api/cycles/${cycleId}/domains/${domainId}/auto-assign`, {
                  method: "POST", credentials: "include",
                });
                if (res.ok) {
                  window.location.reload();
                } else {
                  const body = await res.json().catch(() => ({}));
                  alert(body.error ?? "Auto-assign failed. Check that rubrics are set and reviewers are added.");
                }
              }}
              disabled={!canAssignReviewers || cycleReviewersForDomain.length === 0}
              title={
                !canAssignReviewers
                  ? "Set both domain and general rubrics before assigning reviewers"
                  : cycleReviewersForDomain.length === 0
                    ? "Add reviewers to this domain first"
                    : undefined
              }
              className="px-3 py-1.5 text-xs font-medium rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition disabled:opacity-50"
            >
              Auto-Assign Reviewers
            </button>
          )}
        </div>
      </div>
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-xs font-medium text-muted-foreground uppercase tracking-wide">
          <tr>
            <th className="px-6 py-3 text-left">Applicant</th>
            <th className="px-6 py-3 text-left">Status</th>
            <th className="px-6 py-3 text-left">Reviewers</th>
            <th className="px-6 py-3 text-left">Draft Decision</th>
            <th className="px-6 py-3 text-left">Final Decision</th>
            <th className="px-6 py-3 text-right">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {displayedApps.map((app: any) => {
            const da = app.domainApplications[0];
            const status = da?.inferredStatus ?? "Pending";
            const reviews = da?.reviews ?? [];
            const decisions = da?.decisions ?? [];
            const latestDraft = decisions.find((d: any) => d.stage === "Draft");
            const latestFinal = decisions.find((d: any) => d.stage === "Final");
            return (
              <tr key={app.id} className="hover:bg-muted/50">
                <td className="px-6 py-4 font-medium text-foreground">
                  {app.user.firstName} {app.user.lastName}
                </td>
                <td className="px-6 py-4">
                  <StatusBadge status={status} />
                </td>
                <td className="px-6 py-4">
                  <ReviewerAssignmentCell
                    domainApplicationId={da?.id}
                    reviews={reviews}
                    cycleReviewers={cycleReviewersForDomain}
                    editable={isUnderReview && canAssignReviewers}
                    rubricCriteria={rubricCriteria}
                  />
                </td>
                <td className="px-6 py-4">
                  {latestDraft ? <DecisionBadge type={latestDraft.type} /> : <span className="text-xs text-muted-foreground">—</span>}
                </td>
                <td className="px-6 py-4">
                  {latestFinal ? <DecisionBadge type={latestFinal.type} /> : <span className="text-xs text-muted-foreground">—</span>}
                </td>
                <td className="px-6 py-4 text-right flex items-center justify-end gap-2">
                  {isUnderReview && latestDraft && !latestFinal && (
                    <button
                      onClick={async () => {
                        await fetch(`/api/decisions/${latestDraft.id}/finalize`, { method: "POST", credentials: "include" });
                        window.location.reload();
                      }}
                      className="px-2 py-1 text-xs font-medium rounded bg-green-600 hover:bg-green-700 text-white transition"
                    >
                      Finalize
                    </button>
                  )}
                  <Link
                    to={`/domain-lead/application/${da?.id}`}
                    className="text-blue-600 hover:text-blue-800 font-medium"
                  >
                    Review →
                  </Link>
                </td>
              </tr>
            );
          })}
          {displayedApps.length === 0 && (
            <tr><td colSpan={6} className="px-6 py-8 text-center text-muted-foreground/70 text-sm">
              {filter === "finalize" ? "No applications need finalization." : "No applications."}
            </td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
