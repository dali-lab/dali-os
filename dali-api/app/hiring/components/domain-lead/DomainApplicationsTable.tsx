import { useState } from "react";
import { Link, useSearchParams, useRevalidator } from "react-router";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useToast } from "~/components/ui/toast";
import { summarizeDecisionPills, synthesizePrePipelinePill, currentDecisionId } from "~/hiring/lib/decision-pills";
import { Tooltip, InfoTip } from "~/components/ui/floating";
import { SearchInput } from "~/components/ui/SearchInput";
import { buttonClasses } from "~/components/ui/Button";
import { SegmentedTabButtons } from "~/components/ui/SegmentedTabs";
import type { EngagementSummary } from "~/hiring/lib/email-engagement.server";
import { ApplicantEngagementChip } from "~/hiring/components/ApplicantEmailPanel";
import { canAssignReviewersIn } from "~/hiring/lib/domain-windows";
import { OS_TABLE_HEAD, OS_TABLE_ROW } from "~/hiring/components/domain-lead/table-shared";
import { DecisionPillBadge, PrePipelinePillBadge } from "~/hiring/components/domain-lead/DecisionPills";
import { ReviewerAssignmentCell } from "~/hiring/components/domain-lead/ReviewerAssignmentCell";

export function DomainApplicationsTable({ apps, draftDecisions, cycleReviewersForDomain, cycleId, domainId, currentStatus, canAssignReviewers, rubricCriteria, emailEngagement }: {
  apps: any[];
  emailEngagement: Record<string, EngagementSummary>;
  draftDecisions: any[];
  cycleReviewersForDomain: any[];
  cycleId: string;
  domainId: string;
  currentStatus: string;
  canAssignReviewers: boolean;
  rubricCriteria: any[];
}) {
  const toast = useToast();
  const isUnderReview = currentStatus === "UnderReview";
  const reviewersEditable = canAssignReviewersIn(currentStatus) && canAssignReviewers;
  // Assigning reviewers belongs to a live cycle; finalizing a decision that
  // already exists does not. Keeping the two apart is what lets a closed
  // cycle's leftover Drafts still be finalized. See canFinalize above.
  const canFinalize = true;
  const [searchParams, setSearchParams] = useSearchParams();
  const revalidator = useRevalidator();
  // Which draft is currently being finalized — disables its Finalize button so a
  // double-click can't POST twice (the append-only Decision model would otherwise
  // create duplicate Final rows before the revalidate lands).
  const [finalizingId, setFinalizingId] = useState<string | null>(null);
  const handleFinalize = async (draftId: string) => {
    if (finalizingId) return;
    setFinalizingId(draftId);
    try {
      const res = await fetch(`/api/hiring/decisions/${draftId}/finalize`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok && res.status !== 409) {
        const body = await res.json().catch(() => null);
        toast.error(body?.error ?? "Failed to finalize. Please try again.");
      }
    } finally {
      setFinalizingId(null);
      revalidator.revalidate();
    }
  };
  const filter: "all" | "finalize" = searchParams.get("app_filter") === "finalize" ? "finalize" : "all";
  const query = searchParams.get("q") ?? "";
  // Default sort is "none" — preserves the loader's order (newest application
  // first). Users opt into name/reviewer sort by clicking a column header.
  const sortParam = searchParams.get("sort");
  const sortKey: "none" | "name" | "reviewers" =
    sortParam === "name" ? "name" : sortParam === "reviewers" ? "reviewers" : "none";
  const sortDir: "asc" | "desc" = searchParams.get("dir") === "desc" ? "desc" : "asc";

  const updateParam = (key: string, value: string | null) => {
    setSearchParams(prev => {
      const sp = new URLSearchParams(prev);
      if (!value) sp.delete(key);
      else sp.set(key, value);
      return sp;
    }, { replace: true, preventScrollReset: true });
  };
  const setFilter = (next: "all" | "finalize") => updateParam("app_filter", next === "all" ? null : next);
  const setQuery = (next: string) => updateParam("q", next.trim() === "" ? null : next);
  const toggleSort = (key: "name" | "reviewers") => {
    if (sortKey === key) {
      // Second click on the active column flips direction; a third click clears
      // the sort and returns to loader order.
      if (sortDir === "asc") {
        updateParam("dir", "desc");
      } else {
        setSearchParams(prev => {
          const sp = new URLSearchParams(prev);
          sp.delete("sort");
          sp.delete("dir");
          return sp;
        }, { preventScrollReset: true });
      }
    } else {
      setSearchParams(prev => {
        const sp = new URLSearchParams(prev);
        sp.set("sort", key);
        sp.delete("dir");
        return sp;
      }, { preventScrollReset: true });
    }
  };

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
    return decisions.some((d: any) => {
      if (d.stage !== "Draft") return false;
      return !decisions.some(
        (other: any) => other.type === d.type && (other.stage === "Final" || other.stage === "Released")
      );
    });
  });

  const baseApps = filter === "finalize" ? finalizableApps : apps;
  const lowerQuery = query.trim().toLowerCase();
  const filteredApps = lowerQuery === ""
    ? baseApps
    : baseApps.filter((app: any) => {
        const name = `${app.user.firstName ?? ""} ${app.user.lastName ?? ""}`.toLowerCase();
        return name.includes(lowerQuery);
      });
  const reviewerScore = (app: any) => {
    const reviews = app.domainApplications?.[0]?.reviews ?? [];
    const submitted = reviews.filter((r: any) => r.submittedAt).length;
    return submitted * 10000 + reviews.length;
  };
  const sortedApps = sortKey === "none"
    ? filteredApps
    : [...filteredApps].sort((a: any, b: any) => {
        let cmp = 0;
        if (sortKey === "name") {
          const an = `${a.user.firstName ?? ""} ${a.user.lastName ?? ""}`.toLowerCase();
          const bn = `${b.user.firstName ?? ""} ${b.user.lastName ?? ""}`.toLowerCase();
          cmp = an.localeCompare(bn);
        } else {
          cmp = reviewerScore(a) - reviewerScore(b);
        }
        return sortDir === "asc" ? cmp : -cmp;
      });
  const displayedApps = sortedApps;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {/* The way into the finalize filter, so it outlives the cycle being
            live: a closed cycle still shows it while anything is left to
            finalize, and drops it once nothing is. */}
        {(isUnderReview || finalizableApps.length > 0) && (
          <SegmentedTabButtons
            label="Applicants"
            size="sm"
            items={[
              { label: "All applicants", count: apps.length, active: filter === "all", onClick: () => setFilter("all") },
              { label: "Needs finalization", count: finalizableApps.length, active: filter === "finalize", onClick: () => setFilter("finalize") },
            ]}
          />
        )}
        <SearchInput
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search applicants..."
          aria-label="Search applicants by name"
          size="sm"
          containerClassName="flex-1 min-w-[12rem] max-w-xs"
        />
        {(query || sortKey !== "none") && (
          <button
            type="button"
            onClick={() => {
              setSearchParams(prev => {
                const sp = new URLSearchParams(prev);
                sp.delete("q");
                sp.delete("sort");
                sp.delete("dir");
                return sp;
              }, { preventScrollReset: true });
            }}
            className="text-xs text-os-grey hover:text-foreground"
          >
            Reset
          </button>
        )}
        <span className="text-xs text-os-grey tabular-nums">
          {displayedApps.length} of {baseApps.length}
        </span>
        <div className="ml-auto flex items-center gap-2">
          {canFinalize && filter === "finalize" && finalizableApps.length > 0 && (
            <button
              onClick={async () => {
                for (const app of finalizableApps) {
                  const da = app.domainApplications[0];
                  const allDecisions = da?.decisions ?? [];
                  const draft = allDecisions.find((d: any) => {
                    if (d.stage !== "Draft") return false;
                    return !allDecisions.some(
                      (other: any) => other.type === d.type && (other.stage === "Final" || other.stage === "Released")
                    );
                  });
                  if (draft) {
                    await fetch(`/api/hiring/decisions/${draft.id}/finalize`, { method: "POST", credentials: "include" });
                  }
                }
                revalidator.revalidate();
              }}
              className={buttonClasses("primary", "sm")}
            >
              Finalize all ({finalizableApps.length})
            </button>
          )}
          {canAssignReviewersIn(currentStatus) && (
            <Tooltip
              content={
                !canAssignReviewers
                  ? "A rubric must be set before reviewers can be auto-assigned to applications."
                  : cycleReviewersForDomain.length === 0
                    ? "Add reviewers to this domain first."
                    : !isUnderReview
                      ? "Applications are still coming in. Run this again after the close to cover new ones."
                      : null
              }
              variant="rich"
            >
              <span>
                <button
                  onClick={async () => {
                    const res = await fetch(`/api/hiring/cycles/${cycleId}/domains/${domainId}/auto-assign`, {
                      method: "POST", credentials: "include",
                    });
                    if (res.ok) {
                      revalidator.revalidate();
                    } else {
                      const body = await res.json().catch(() => ({}));
                      toast.error(body.error ?? "Auto-assign failed. Check that rubrics are set and reviewers are added.");
                    }
                  }}
                  disabled={!canAssignReviewers || cycleReviewersForDomain.length === 0}
                  className={buttonClasses("secondary", "sm")}
                >
                  Auto-assign reviewers
                </button>
              </span>
            </Tooltip>
          )}
        </div>
      </div>
      <div className="hidden sm:block -mx-6 overflow-x-auto">
      <table className="w-full text-sm min-w-[640px]">
        <thead className={OS_TABLE_HEAD}>
          <tr>
            <th className="px-6 py-3 text-left font-medium">
              <button
                type="button"
                onClick={() => toggleSort("name")}
                className="inline-flex items-center gap-1 hover:text-foreground"
                aria-label={`Sort by applicant name (${sortKey === "name" ? (sortDir === "asc" ? "ascending" : "descending") : "not sorted"})`}
              >
                Applicant
                {sortKey === "name" && (sortDir === "asc"
                  ? <ChevronUp className="w-3 h-3" />
                  : <ChevronDown className="w-3 h-3" />)}
              </button>
            </th>
            <th className="px-6 py-3 text-left font-medium">
              <button
                type="button"
                onClick={() => toggleSort("reviewers")}
                className="inline-flex items-center gap-1 hover:text-foreground"
                aria-label={`Sort by reviewer progress (${sortKey === "reviewers" ? (sortDir === "asc" ? "ascending" : "descending") : "not sorted"})`}
              >
                Reviewers
                {sortKey === "reviewers" && (sortDir === "asc"
                  ? <ChevronUp className="w-3 h-3" />
                  : <ChevronDown className="w-3 h-3" />)}
              </button>
            </th>
            <th className="px-6 py-3 text-left font-medium">
              <span className="inline-flex items-center gap-1">
                Decisions
                <InfoTip content="Pre-pipeline pills show where this application stands before a formal decision — Reviewing, Interview scheduled, or Post-interview. Formal decision pills (Draft → Final → Released) appear once a decision is made." />
              </span>
            </th>
            <th className="px-6 py-3 text-right font-medium">Actions</th>
          </tr>
        </thead>
        <tbody>
          {displayedApps.map((app: any) => {
            const da = app.domainApplications[0];
            const reviews = da?.reviews ?? [];
            const decisions = da?.decisions ?? [];
            const draftToFinalize = decisions.find((d: any) => {
              if (d.stage !== "Draft") return false;
              return !decisions.some(
                (other: any) => other.type === d.type && (other.stage === "Final" || other.stage === "Released")
              );
            });
            const pills = da
              ? summarizeDecisionPills({ decisions })
              : [];
            const currentId = currentDecisionId(decisions);
            const prePill = da && pills.length === 0
              ? synthesizePrePipelinePill({
                  application: { statusUpdates: app.statusUpdates ?? [] },
                  interviews: da.interviews ?? [],
                  decisions,
                })
              : null;
            const daId = da?.id as string | undefined;
            return (
              <tr key={app.id} className={OS_TABLE_ROW}>
                <td className="px-6 py-4 font-medium">
                  <span className="inline-flex items-center gap-2">
                  {daId ? (
                    <Link
                      to={`/hiring/domain-lead/application/${daId}`}
                      className="text-foreground hover:text-os-accent"
                    >
                      {app.user.firstName} {app.user.lastName}
                    </Link>
                  ) : (
                    <span className="text-foreground">{app.user.firstName} {app.user.lastName}</span>
                  )}
                  <ApplicantEngagementChip summary={emailEngagement[app.userId]} />
                  </span>
                </td>
                <td className="px-6 py-4">
                  <ReviewerAssignmentCell
                    domainApplicationId={da?.id}
                    reviews={reviews}
                    cycleReviewers={cycleReviewersForDomain}
                    editable={reviewersEditable}
                    rubricCriteria={rubricCriteria}
                  />
                </td>
                <td className="px-6 py-4">
                  {pills.length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      {pills.map((pill, i) => (
                        <DecisionPillBadge key={i} pill={pill} isCurrent={!!pill.id && pill.id === currentId} />
                      ))}
                    </div>
                  ) : prePill ? (
                    <PrePipelinePillBadge pill={prePill} />
                  ) : (
                    <span className="text-xs text-os-grey">—</span>
                  )}
                </td>
                <td className="px-6 py-4 text-right">
                  <div className="flex flex-wrap items-center justify-end gap-2">
                  {canFinalize && draftToFinalize ? (
                    <button
                      onClick={() => handleFinalize(draftToFinalize.id)}
                      disabled={finalizingId === draftToFinalize.id}
                      className={buttonClasses("secondary", "xs")}
                    >
                      {finalizingId === draftToFinalize.id ? "Finalizing…" : "Finalize"}
                    </button>
                  ) : (
                    <span className="text-xs text-os-grey">—</span>
                  )}
                  </div>
                </td>
              </tr>
            );
          })}
          {displayedApps.length === 0 && (
            <tr><td colSpan={isUnderReview && canAssignReviewers ? 5 : 4} className="px-6 py-8 text-center text-os-grey text-sm">
              {filter === "finalize" ? "No applications need finalization." : "No applications."}
            </td></tr>
          )}
        </tbody>
      </table>
      </div>
      <ul className="sm:hidden -mx-6 divide-y divide-os-container border-t border-os-container">
        {displayedApps.map((app: any) => {
          const da = app.domainApplications[0];
          const reviews = da?.reviews ?? [];
          const decisions = da?.decisions ?? [];
          const draftToFinalize = decisions.find((d: any) => {
            if (d.stage !== "Draft") return false;
            return !decisions.some(
              (other: any) => other.type === d.type && (other.stage === "Final" || other.stage === "Released")
            );
          });
          const pills = da
            ? summarizeDecisionPills({ decisions })
            : [];
          const currentId = currentDecisionId(decisions);
          const prePill = da && pills.length === 0
            ? synthesizePrePipelinePill({
                application: { statusUpdates: app.statusUpdates ?? [] },
                interviews: da.interviews ?? [],
                decisions,
              })
            : null;
          const daId = da?.id as string | undefined;
          return (
            <li key={app.id} className="px-6 py-3 space-y-2">
              <div className="flex items-center gap-2">
                {daId ? (
                  <Link
                    to={`/hiring/domain-lead/application/${daId}`}
                    className="font-medium text-foreground hover:text-os-accent"
                  >
                    {app.user.firstName} {app.user.lastName}
                  </Link>
                ) : (
                  <div className="font-medium text-foreground">
                    {app.user.firstName} {app.user.lastName}
                  </div>
                )}
              </div>
              <div>
                <div className="text-[10px] font-bold text-os-grey uppercase tracking-wider mb-1">Reviewers</div>
                <ReviewerAssignmentCell
                  domainApplicationId={da?.id}
                  reviews={reviews}
                  cycleReviewers={cycleReviewersForDomain}
                  editable={reviewersEditable}
                  rubricCriteria={rubricCriteria}
                />
              </div>
              <div>
                <div className="text-[10px] font-bold text-os-grey uppercase tracking-wider mb-1">Decisions</div>
                {pills.length > 0 ? (
                  <div className="flex flex-wrap gap-1">
                    {pills.map((pill, i) => (
                      <DecisionPillBadge key={i} pill={pill} isCurrent={!!pill.id && pill.id === currentId} />
                    ))}
                  </div>
                ) : prePill ? (
                  <PrePipelinePillBadge pill={prePill} />
                ) : (
                  <span className="text-xs text-os-grey">—</span>
                )}
              </div>
              {canFinalize && draftToFinalize && (
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={() => handleFinalize(draftToFinalize.id)}
                    disabled={finalizingId === draftToFinalize.id}
                    className={buttonClasses("secondary", "xs")}
                  >
                    {finalizingId === draftToFinalize.id ? "Finalizing…" : "Finalize"}
                  </button>
                </div>
              )}
            </li>
          );
        })}
        {displayedApps.length === 0 && (
          <li className="px-6 py-8 text-center text-os-grey text-sm">
            {filter === "finalize" ? "No applications need finalization." : "No applications."}
          </li>
        )}
      </ul>
    </div>
  );
}
