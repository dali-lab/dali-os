import { useState } from "react";
import { useLoaderData, useSearchParams } from "react-router";
import { FileText, Inbox, Presentation } from "lucide-react";
import { useOsChrome } from "~/components/os-chrome";
import { Avatar } from "~/components/ui/Avatar";
import { Segmented } from "~/components/ui/Segmented";
import { cn } from "~/lib/cn";
import { relativeTime } from "~/lib/relative-time";
import { LoadMore } from "~/components/ui/Pager";
import { fetchCursorPage, useLoadMore } from "~/hooks/useLoadMore";
import type { ReviewEntry } from "~/journeys/lib/studio.server";
import type { loader } from "~/journeys/routes/journeys.reviews";
import { BackLink } from "~/journeys/components/BackLink";
import { JOURNEYS_HOME } from "~/journeys/lib/paths";
import { ReviewDetail } from "./ReviewDetail";

type Filter = "waiting" | "reviewed";

/** Lab work sent for review on journeys the viewer can edit. */
export function ReviewsPage() {
  const data = useLoaderData<typeof loader>();
  const { pageTitle, bodyText } = useOsChrome();
  const [params, setParams] = useSearchParams();
  const requested = params.get("submission");
  const [filter, setFilter] = useState<Filter>(() =>
    data.reviewed.find((e) => e.submission.id === requested && e.submission.status !== "submitted") ? "reviewed" : "waiting",
  );

  const waiting = data.waiting;
  const { items: loadedReviewed, pager } = useLoadMore<ReviewEntry>({
    items: data.reviewed,
    nextCursor: data.nextCursor,
    fetchPage: (cursor) => fetchCursorPage<ReviewEntry>(`/journeys/reviews/more?cursor=${encodeURIComponent(cursor)}`),
    idOf: (e) => e.submission.id,
  });
  const reviewed = loadedReviewed.filter((e) => e.submission.status !== "submitted");
  const visible = filter === "waiting" ? waiting : reviewed;
  const selected = visible.find((e) => e.submission.id === requested) ?? visible[0] ?? null;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6">
      <header className="shrink-0">
        <BackLink to={JOURNEYS_HOME}>Journeys</BackLink>
        <h1 className={cn(pageTitle, "mt-2")}>Reviews</h1>
        <p className={cn(bodyText, "mt-1")}>Lab work waiting for a mentor on journeys you can edit.</p>
      </header>

      <div className="grid min-h-0 flex-1 gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
        <div className="flex min-h-0 flex-col gap-3">
          <Segmented
            ariaLabel="Filter reviews"
            fullWidth
            size="md"
            value={filter}
            onChange={setFilter}
            options={[
              { value: "waiting", label: `Waiting ${data.counts.waiting}` },
              { value: "reviewed", label: `Reviewed ${data.counts.reviewed}` },
            ]}
          />
          <ul className="max-h-[320px] min-h-0 flex-1 space-y-0.5 overflow-y-auto lg:max-h-none">
            {visible.length === 0 && (
              <li className="px-3 py-6 text-sm text-os-muted">
                {filter === "waiting" ? "Nothing waiting for you. Submissions on journeys you can edit show up here." : "No reviewed work yet."}
              </li>
            )}
            {visible.map((e) => {
              const active = selected?.submission.id === e.submission.id;
              const KindIcon = e.studio.kind === "canvas" ? Presentation : FileText;
              const s = e.submission;
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => setParams({ submission: s.id }, { replace: true })}
                    aria-current={active ? "true" : undefined}
                    className={cn("flex w-full items-start gap-3 rounded-os-item px-3 py-3 text-left transition-colors", active ? "bg-os-card" : "hover:bg-os-hover")}
                  >
                    <Avatar photoUrl={e.learner.photoUrl} name={e.learner.name} size="sm" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-foreground">{e.learner.name}</span>
                      <span className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-os-grey">
                        <KindIcon className="h-3 w-3 shrink-0" aria-hidden />
                        <span className="truncate">{e.studio.title}</span>
                      </span>
                      <span className="mt-0.5 block text-xs text-os-muted">
                        {s.status === "approved"
                          ? "Approved"
                          : s.status === "changes-requested"
                            ? "Changes requested"
                            : s.submittedAt
                              ? relativeTime(s.submittedAt)
                              : "Submitted"}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
            {filter === "reviewed" && (
              <li>
                <LoadMore {...pager} />
              </li>
            )}
          </ul>
        </div>

        <div className="min-h-0">
          {selected ? (
            <ReviewDetail key={`${selected.submission.id}:${selected.submission.status}`} entry={selected} />
          ) : (
            <div className="grid h-full min-h-[320px] place-items-center rounded-os-card bg-os-card p-5 text-center">
              <div>
                <Inbox className="mx-auto h-8 w-8 text-os-muted" aria-hidden />
                <p className="mt-3 text-os-grey">Pick a submission to review it.</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
