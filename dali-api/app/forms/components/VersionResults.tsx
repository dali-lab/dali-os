import { useEffect, useMemo, useState } from "react";
import { Link, useFetcher, useSearchParams } from "react-router";
import { SearchInput } from "~/components/ui/SearchInput";
import { PagerLinks } from "~/components/ui/Pager";
import { Select } from "~/components/ui/floating";
import { Modal, ModalHeader } from "~/components/Modal";
import type {
  ResponseRow,
  VersionResponses,
} from "~/forms/lib/version-responses.server";
import { modalCardClass } from "~/components/os-chrome";
import { Button } from "~/components/ui/Button";
import { useConfirmSubmit } from "~/components/ui/dialog";
import { FormTracker } from "~/forms/components/FormTracker";
import { ExportCsvLink, ResultsViewToggle, setResultsTab } from "~/forms/components/ResultsControls";
import { AnswerFilterButton, AnswerFilterChips, useAnswerFilters } from "~/forms/components/AnswerFilters";
import type { TrackerCounts } from "~/forms/lib/form-tracker";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function ResponseDetailBody({ response }: { response: ResponseRow }) {
  return (
    <div className="space-y-4">
      {response.partnerApplication && (
        <Link
          to={`/core/partners/applications/${response.partnerApplication.id}`}
          className="inline-block text-xs font-medium text-os-accent hover:underline"
        >
          Partner application: {response.partnerApplication.title} →
        </Link>
      )}
      <dl className="flex flex-col gap-3">
        {response.rows.map((row) => (
          <div key={row.key}>
            <dt className="text-xs font-medium text-muted-foreground mb-0.5">
              {row.label}
            </dt>
            <dd className="text-sm text-foreground whitespace-pre-wrap">
              {row.value || "—"}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

// Owner delete of one response, or the reason it has to stay. The form action
// refuses locked responses too; this just says why instead of offering a button.
function ResponseDelete({ response }: { response: ResponseRow }) {
  const fetcher = useFetcher<{ ok?: true; error?: string }>();
  const confirmSubmit = useConfirmSubmit();
  if (response.lockReason) {
    return (
      <p className="mt-6 text-xs text-muted-foreground">
        This response can't be deleted. {response.lockReason}
      </p>
    );
  }
  const error = fetcher.data && "error" in fetcher.data ? fetcher.data.error : null;
  return (
    <fetcher.Form
      method="post"
      className="mt-6 flex items-center gap-3"
      onSubmit={confirmSubmit({
        title: `Delete this response from ${response.name}?`,
        description: "This can't be undone.",
        tone: "destructive",
        confirmLabel: "Delete",
      })}
    >
      <input type="hidden" name="intent" value="delete-form-response" />
      <input type="hidden" name="submissionId" value={response.id} />
      <Button type="submit" variant="destructive" size="sm" disabled={fetcher.state !== "idle"}>
        {fetcher.state !== "idle" ? "Deleting…" : "Delete response"}
      </Button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </fetcher.Form>
  );
}

// One version's responses: a page of submissions with a detail modal, a slot
// filter when staffing fills are present, answer filters, and CSV export of
// what matches. Page, search, slot and answer filters live in the URL and are
// applied by the loader.
export function VersionResults({
  formId,
  versionNumber,
  results,
  tracker = null,
}: {
  formId: string;
  versionNumber: number;
  results: VersionResponses;
  tracker?: TrackerCounts | null;
}) {
  const {
    isPartnerApplicationForm,
    totalCount,
    matchCount,
    page,
    hasNext,
    columns,
    slotOptions,
    filterQuestions,
    responses,
  } = results;
  const [searchParams, setSearchParams] = useSearchParams();
  const urlQuery = searchParams.get("q") ?? "";
  const slot = searchParams.get("slot") ?? "";
  const [query, setQuery] = useState(urlQuery);
  const [openId, setOpenId] = useState<string | null>(null);
  const answerFilters = useAnswerFilters(filterQuestions);
  const narrowed = Boolean(urlQuery || slot || answerFilters.active.length);

  function clearFilters() {
    setQuery("");
    const next = new URLSearchParams(searchParams);
    for (const key of ["q", "slot", "a", "page"]) next.delete(key);
    setSearchParams(next, { replace: true, preventScrollReset: true });
  }

  // Filters start over at the first page; every other param (view, version) stays.
  function updateParams(changes: Record<string, string>) {
    const next = new URLSearchParams(searchParams);
    next.delete("page");
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    setSearchParams(next, { replace: true, preventScrollReset: true });
  }

  useEffect(() => {
    if (query.trim() === urlQuery) return;
    const timer = setTimeout(() => updateParams({ q: query.trim() }), 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const rows = useMemo(
    () =>
      responses.map((r) => ({
        ...r,
        values: new Map(r.rows.map((row) => [row.key, row.value])),
      })),
    [responses],
  );

  function pageHref(target: number) {
    const next = new URLSearchParams(searchParams);
    if (target > 1) next.set("page", String(target));
    else next.delete("page");
    return `?${next.toString()}`;
  }

  const selected = responses.find((r) => r.id === openId) ?? null;
  const hasSlotColumn = slotOptions.length > 0;
  const trackerLine = tracker && <FormTracker formId={formId} counts={tracker} />;
  const viewToggle = (
    <ResultsViewToggle
      value="responses"
      onChange={(tab) =>
        setSearchParams(setResultsTab(searchParams, tab), {
          replace: true,
          preventScrollReset: true,
        })
      }
    />
  );

  return (
    <div className="space-y-4">
      {isPartnerApplicationForm && (
        <Link
          to="/core/partners"
          className="block bg-os-accent/10 rounded-os-item px-4 py-3 text-sm text-os-accent font-medium hover:bg-os-accent/15 transition"
        >
          These responses are partner applications. Review them on the
          Partner Applications board →
        </Link>
      )}

      {totalCount === 0 ? (
        <>
          {viewToggle}
          {trackerLine}
          <div className="text-center py-12 rounded-os-card bg-os-card">
            <p className="text-sm text-muted-foreground">
              No responses to v{versionNumber} yet.
            </p>
          </div>
        </>
      ) : (
        <>
          <div className="flex flex-col sm:flex-row sm:items-center gap-2">
            {viewToggle}
            <span className="text-sm text-os-grey">
              {totalCount} {totalCount === 1 ? "response" : "responses"}
              {matchCount !== totalCount && ` · ${matchCount} match`}
            </span>
            {hasSlotColumn && (
              <Select
                ariaLabel="Filter by slot"
                value={slot}
                onChange={(v) => updateParams({ slot: v })}
                placeholder="All slots"
                options={[
                  { value: "", label: "All slots" },
                  ...slotOptions.map((s) => ({ value: s, label: s })),
                ]}
                buttonClassName="px-3 py-1.5 text-sm border border-os-container rounded-full bg-os-well text-foreground sm:w-48 inline-flex items-center justify-between gap-1 transition-colors hover:border-os-container-hi"
              />
            )}
            <AnswerFilterButton questions={filterQuestions} />
            <SearchInput
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name, email or answer"
              aria-label="Search responses by name, email or answer"
              size="sm"
              containerClassName="w-full sm:ml-auto sm:w-64 min-w-[12rem]"
            />
            <ExportCsvLink
              formId={formId}
              versionNumber={versionNumber}
              searchParams={searchParams}
              matching={narrowed ? matchCount : undefined}
            />
          </div>

          <AnswerFilterChips questions={filterQuestions} />

          {trackerLine}

          <div className="rounded-os-card bg-os-card overflow-hidden">
            {rows.length === 0 ? (
              <div className="flex flex-col items-center gap-3 px-4 py-8 text-center text-sm text-muted-foreground">
                No responses match the current filters.
                {narrowed && (
                  <Button variant="secondary" size="sm" onClick={clearFilters}>
                    Clear filters
                  </Button>
                )}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[640px]">
                  <thead className="text-os-grey text-xs">
                    <tr>
                      <th className="text-left font-medium px-4 py-3">
                        Respondent ({matchCount})
                      </th>
                      <th className="text-left font-medium px-4 py-3">Email</th>
                      <th className="text-left font-medium px-4 py-3">
                        Submitted
                      </th>
                      {hasSlotColumn && (
                        <th className="text-left font-medium px-4 py-3">Slot</th>
                      )}
                      {columns.map((c) => (
                        <th key={c.key} className="text-left font-medium px-4 py-3">
                          <div className="max-w-[16rem] truncate" title={c.label}>
                            {c.label}
                          </div>
                        </th>
                      ))}
                      {isPartnerApplicationForm && (
                        <th className="text-left font-medium px-4 py-3">
                          Partner app
                        </th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr
                        key={r.id}
                        onClick={() => setOpenId(r.id)}
                        className="border-t border-os-container hover:bg-os-card-hover cursor-pointer"
                      >
                        <td className="px-4 py-2.5 text-foreground font-medium whitespace-nowrap">
                          {r.name}
                        </td>
                        <td className="px-4 py-2.5 text-muted-foreground">
                          {r.email ?? "—"}
                        </td>
                        <td className="px-4 py-2.5 text-muted-foreground whitespace-nowrap">
                          {formatDate(r.createdAt)}
                          {r.edited && (
                            <span className="ml-1.5 text-xs text-os-grey">Edited</span>
                          )}
                        </td>
                        {hasSlotColumn && (
                          <td className="px-4 py-2.5 text-muted-foreground">
                            {r.slot ?? "—"}
                          </td>
                        )}
                        {columns.map((c) => {
                          const value = r.values.get(c.key) ?? "";
                          return (
                            <td key={c.key} className="px-4 py-2.5 text-foreground">
                              <div
                                className="max-w-[16rem] truncate"
                                title={value || undefined}
                              >
                                {value || "—"}
                              </div>
                            </td>
                          );
                        })}
                        {isPartnerApplicationForm && (
                          <td className="px-4 py-2.5">
                            {r.partnerApplication ? (
                              <Link
                                to={`/core/partners/applications/${r.partnerApplication.id}`}
                                onClick={(e) => e.stopPropagation()}
                                className="text-xs font-medium text-os-accent hover:underline whitespace-nowrap"
                              >
                                {r.partnerApplication.title} →
                              </Link>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          {(page > 1 || hasNext) && (
            <PagerLinks
              page={page}
              hasNext={hasNext}
              hrefFor={pageHref}
              label="Responses pagination"
              endLabel="End of responses"
            />
          )}
        </>
      )}

      <Modal
        open={selected !== null}
        onClose={() => setOpenId(null)}
        labelledBy="response-detail-title"
        containerClassName={modalCardClass("max-w-2xl")}
      >
        {selected && (
          <>
            <ModalHeader
              titleId="response-detail-title"
              title={selected.name}
              subtitle={[
                selected.email,
                formatTimestamp(selected.createdAt),
                selected.edited && "Edited",
                selected.slot,
                selected.submitterIp && `IP ${selected.submitterIp}`,
              ]
                .filter(Boolean)
                .join(" · ")}
              onClose={() => setOpenId(null)}
            />
            <ResponseDetailBody response={selected} />
            <ResponseDelete response={selected} />
          </>
        )}
      </Modal>
    </div>
  );
}
