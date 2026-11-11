import { useSearchParams } from "react-router";
import type { ReactNode } from "react";
import { ResultsFilterBar, responseCountText, useAnswerFilters } from "~/forms/components/ResultsFilterBar";
import { Button } from "~/components/ui/Button";
import { FormTracker } from "~/forms/components/FormTracker";
import { ExportCsvLink, resultsViewParams } from "~/forms/components/ResultsControls";
import type { TrackerCounts } from "~/forms/lib/form-tracker";
import type { VersionSummary as VersionSummaryData } from "~/forms/lib/version-summary.server";
import type { Bar, QuestionSummary, SkillRow } from "~/forms/lib/version-summary";
import { plural } from "~/forms/lib/form-tracker";
import { cn } from "~/lib/cn";

const LABEL_LANE = "w-[152px] shrink-0 truncate text-sm text-foreground";

function BarRow({ bar, max }: { bar: Bar; max: number }) {
  return (
    <div className={cn("flex items-center gap-3", bar.other && "text-os-grey")}>
      <span className={cn(LABEL_LANE, bar.other && "text-os-grey")} title={bar.label}>
        {bar.label}
      </span>
      <div className="h-2 flex-1 min-w-0 rounded-full bg-os-well">
        <div
          role="presentation"
          data-bar
          className={cn("h-full rounded-full", bar.other ? "bg-os-grey/30" : "bg-os-accent/30")}
          style={{ width: `${max === 0 ? 0 : (bar.count / max) * 100}%` }}
        />
      </div>
      <span className="w-8 text-right text-sm font-semibold tabular-nums text-foreground">
        {bar.count}
      </span>
      <span className="w-10 text-right text-sm tabular-nums text-os-grey">{bar.percent}%</span>
    </div>
  );
}

function Bars({ bars }: { bars: Bar[] }) {
  const max = Math.max(0, ...bars.map((b) => b.count));
  return (
    <div className="space-y-2">
      {bars.map((bar) => (
        <BarRow key={`${bar.other ? "other:" : ""}${bar.label}`} bar={bar} max={max} />
      ))}
    </div>
  );
}

function SkillLine({ row }: { row: SkillRow }) {
  const max = Math.max(0, ...row.distribution);
  return (
    <div className="flex items-center gap-3">
      <span className={LABEL_LANE} title={row.skill}>
        {row.skill}
      </span>
      <div className="flex h-6 flex-1 items-end gap-1" aria-hidden>
        {row.distribution.map((n, rating) => (
          <div key={rating} className="flex h-full flex-1 items-end rounded-sm bg-os-well">
            <div
              data-bar
              className="w-full rounded-sm bg-os-accent/30"
              style={{ height: `${max === 0 ? 0 : (n / max) * 100}%` }}
            />
          </div>
        ))}
      </div>
      <span className="w-24 text-right text-sm tabular-nums text-os-grey">
        {row.average === null ? (
          "Not rated"
        ) : (
          <>
            <strong className="font-semibold text-foreground">{row.average}</strong> of 5
          </>
        )}
      </span>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | null }) {
  return (
    <div>
      <div className="text-xs text-os-grey">{label}</div>
      <div className="text-lg font-semibold tabular-nums text-foreground">{value ?? "-"}</div>
    </div>
  );
}

function Answers({ q, onRead }: { q: QuestionSummary; onRead: () => void }) {
  switch (q.kind) {
    case "choice":
      return <Bars bars={q.bars} />;
    case "skills":
      return (
        <div className="space-y-2">
          {q.skills.map((row) => (
            <SkillLine key={row.skill} row={row} />
          ))}
        </div>
      );
    case "scale":
      return (
        <div className="space-y-3">
          <div className="text-3xl font-semibold tabular-nums text-foreground">
            {q.average ?? "-"}
            {q.average !== null && <span className="ml-1 text-sm font-normal text-os-grey">of 5</span>}
          </div>
          <Bars bars={q.bars} />
        </div>
      );
    case "number":
      return (
        <div className="flex gap-8">
          <Stat label="Count" value={q.count} />
          <Stat label="Average" value={q.average} />
          <Stat label="Lowest" value={q.lowest} />
          <Stat label="Highest" value={q.highest} />
        </div>
      );
    case "text":
      return q.answered === 0 ? (
        <span className="text-sm text-os-grey">No answers</span>
      ) : (
        <button
          type="button"
          onClick={onRead}
          className="text-sm font-medium text-os-accent hover:underline"
        >
          Read {q.answered} {plural(q.answered, "answer", "answers")}
        </button>
      );
  }
}

export function VersionSummary({
  formId,
  versionNumber,
  data,
  tracker = null,
  lead,
  totalCount,
}: {
  formId: string;
  versionNumber: number;
  data: VersionSummaryData;
  tracker?: TrackerCounts | null;
  lead: ReactNode;
  // Every response to the version, before filters; defaults to what the summary covers.
  totalCount?: number;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const slot = searchParams.get("slot") ?? "";
  const { summary, slotOptions, filterQuestions } = data;
  const answerFilters = useAnswerFilters(filterQuestions);
  const narrowed = Boolean(slot || answerFilters.active.length);

  function clearFilters() {
    const next = new URLSearchParams(searchParams);
    for (const key of ["slot", "a"]) next.delete(key);
    setSearchParams(next, { replace: true, preventScrollReset: true });
  }

  function readResponses() {
    setSearchParams(resultsViewParams(searchParams, "responses", versionNumber), {
      replace: true,
      preventScrollReset: true,
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {lead}
        <div className="sm:ml-auto">
          <ExportCsvLink
            formId={formId}
            versionNumber={versionNumber}
            searchParams={searchParams}
            search={false}
            matching={narrowed ? summary.total : undefined}
          />
        </div>
      </div>

      <ResultsFilterBar
        questions={filterQuestions}
        slotOptions={slotOptions}
        count={responseCountText(summary.total, Math.max(totalCount ?? summary.total, summary.total))}
      />

      {tracker && <FormTracker formId={formId} counts={tracker} />}

      {summary.total === 0 ? (
        narrowed ? (
          <div className="flex flex-col items-center gap-3 py-12 text-center text-sm text-muted-foreground">
            No responses match the current filters.
            <Button variant="secondary" size="sm" onClick={clearFilters}>
              Clear filters
            </Button>
          </div>
        ) : (
          <p className="py-12 text-center text-sm text-muted-foreground">No responses yet.</p>
        )
      ) : (
        <div className="divide-y divide-os-container">
          {summary.questions.map((q) => (
            <section
              key={q.key}
              className="grid gap-x-8 gap-y-3 py-5 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]"
            >
              <div>
                <div className="flex gap-3">
                  <span className="text-sm font-medium text-muted-foreground">Q{q.number}</span>
                  <h4 className="text-base font-medium text-foreground">{q.label}</h4>
                </div>
                <p className="mt-1 pl-8 text-sm text-os-grey">
                  {q.answered} answered, {q.skipped} skipped
                </p>
                {q.asked && (
                  <p className="pl-8 text-sm text-os-grey">
                    Asked {q.asked.count} {plural(q.asked.count, "person", "people")} {q.asked.who}
                  </p>
                )}
              </div>
              <Answers q={q} onRead={readResponses} />
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
