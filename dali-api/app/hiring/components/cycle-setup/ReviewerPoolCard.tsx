import { useFetcher } from "react-router";
import { X } from "lucide-react";
import { buttonClasses } from "~/components/ui/Button";
import { Select, Tooltip } from "~/components/ui/floating";
import { useOsChrome } from "~/components/os-chrome";
import { cn } from "~/lib/cn";
import { Pill, SetupCard, rowTrigger } from "./SetupCard";

const MIN_POOL_SIZE = 2;

// The single reviewer pool Interns and Lab members cycles use: every reviewer
// reads every application, whatever domain it targets.
export function ReviewerPoolCard({
  reviewers,
  members,
  hasDomains,
  canResetToDefault,
}: {
  reviewers: { userId: string; displayName: string }[];
  members: { userId: string; displayName: string }[];
  hasDomains: boolean;
  /** Lab members cycles default the pool to the graduating Core seniors. */
  canResetToDefault: boolean;
}) {
  const { bodyText, formTrigger } = useOsChrome();
  const fetcher = useFetcher<{ error?: string }>();
  const assignedIds = new Set(reviewers.map((r) => r.userId));
  const candidates = members.filter((m) => !assignedIds.has(m.userId));
  const meetsMin = reviewers.length >= MIN_POOL_SIZE;

  return (
    <SetupCard
      title="Reviewer pool"
      description={`Every reviewer reads every application. Add at least ${MIN_POOL_SIZE}.`}
      action={
        <Pill tone={meetsMin ? "accent" : "warning"}>
          {reviewers.length} of {MIN_POOL_SIZE}
        </Pill>
      }
    >
      {!hasDomains ? (
        <p className={cn(bodyText, "py-4 text-center")}>Pick target domains on Setup first.</p>
      ) : (
        <>
          <div className="flex flex-col gap-2">
            {reviewers.map((r) => (
              <div key={r.userId} className="flex items-center justify-between gap-3 rounded-os-item bg-os-well px-4 py-3">
                <span className="text-sm font-semibold text-foreground">{r.displayName}</span>
                <Tooltip content="Remove">
                  <button
                    type="button"
                    aria-label={`Remove ${r.displayName}`}
                    onClick={() =>
                      fetcher.submit({ intent: "remove-reviewer-pool", userId: r.userId }, { method: "post" })
                    }
                    className="rounded-os-item p-1.5 text-os-grey transition-colors hover:bg-os-container hover:text-foreground"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </Tooltip>
              </div>
            ))}
            {reviewers.length === 0 && <p className={cn(bodyText, "py-3 text-center")}>No reviewers yet.</p>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="w-full max-w-xs">
              <Select
                ariaLabel="Add reviewer"
                value=""
                placeholder="Add person"
                onChange={(userId) => {
                  if (userId) fetcher.submit({ intent: "add-reviewer-pool", userId }, { method: "post" });
                }}
                options={candidates.map((m) => ({ value: m.userId, label: m.displayName }))}
                buttonClassName={rowTrigger(formTrigger)}
              />
            </div>
            {canResetToDefault && (
              <button
                type="button"
                onClick={() => fetcher.submit({ intent: "reset-default-reviewers" }, { method: "post" })}
                className={buttonClasses("secondary", "sm")}
              >
                Reset to graduating Core seniors
              </button>
            )}
          </div>
        </>
      )}
      {fetcher.data?.error && <p className="text-sm text-red-700">{fetcher.data.error}</p>}
    </SetupCard>
  );
}
