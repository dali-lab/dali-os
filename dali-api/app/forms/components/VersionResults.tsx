import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useFetcher, useSearchParams } from "react-router";
import { SearchInput } from "~/components/ui/SearchInput";
import { PagerLinks } from "~/components/ui/Pager";
import type {
  ResponseRow,
  VersionResponses,
} from "~/forms/lib/version-responses.server";
import { Button } from "~/components/ui/Button";
import { useConfirmSubmit } from "~/components/ui/dialog";
import { FormTracker } from "~/forms/components/FormTracker";
import { ExportCsvLink } from "~/forms/components/ResultsControls";
import { ResultsFilterBar, responseCountText, useAnswerFilters } from "~/forms/components/ResultsFilterBar";
import type { TrackerCounts } from "~/forms/lib/form-tracker";
import { ResponseTable, type ColumnControls } from "~/forms/components/ResponseTable";
import { ResponseDrawer } from "~/forms/components/ResponseDrawer";

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

function responseSubtitle(response: ResponseRow): string {
  return [
    response.email,
    formatTimestamp(response.createdAt),
    response.edited && "Edited",
    response.slot,
    response.submitterIp && `IP ${response.submitterIp}`,
  ]
    .filter(Boolean)
    .join(" · ");
}

function PartnerApplicationLink({ response }: { response: ResponseRow }) {
  if (!response.partnerApplication) return null;
  return (
    <Link
      to={`/core/partners/applications/${response.partnerApplication.id}`}
      className="mb-4 inline-block text-xs font-medium text-os-accent hover:underline"
    >
      Partner application: {response.partnerApplication.title} →
    </Link>
  );
}

function ResponseDelete({ response }: { response: ResponseRow }) {
  const fetcher = useFetcher<{ ok?: true; error?: string }>();
  const confirmSubmit = useConfirmSubmit();
  if (response.deleteBlocked) {
    return (
      <p className="text-xs text-muted-foreground">
        This response can't be deleted. {response.deleteBlocked}
      </p>
    );
  }
  const error = fetcher.data && "error" in fetcher.data ? fetcher.data.error : null;
  return (
    <fetcher.Form
      method="post"
      className="flex items-center gap-3"
      onSubmit={confirmSubmit({
        title: `Delete this response from ${response.name}?`,
        description: [...response.deleteEffects, "This can't be undone."].join(" "),
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

function useResultColumns(available: { key: string; label: string }[]): ColumnControls {
  const fetcher = useFetcher<{ ok?: true; error?: string }>();
  return {
    available,
    edit: (op) =>
      fetcher.submit(
        { intent: "response-column", op: JSON.stringify(op) },
        { method: "post", preventScrollReset: true },
      ),
  };
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
  lead,
}: {
  formId: string;
  versionNumber: number;
  results: VersionResponses;
  tracker?: TrackerCounts | null;
  lead: ReactNode;
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
  const columnControls = useResultColumns(results.hiddenColumns);
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
          {lead}
          {trackerLine}
          <div className="text-center py-12 rounded-os-card bg-os-card">
            <p className="text-sm text-muted-foreground">
              No responses to v{versionNumber} yet.
            </p>
          </div>
        </>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            {lead}
            <div className="flex w-full flex-wrap items-center gap-2 sm:ml-auto sm:w-auto">
              <SearchInput
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search by name, email or answer"
                aria-label="Search responses by name, email or answer"
                size="sm"
                containerClassName="w-full sm:w-64 min-w-[12rem]"
              />
              <ExportCsvLink
                formId={formId}
                versionNumber={versionNumber}
                searchParams={searchParams}
                matching={narrowed ? matchCount : undefined}
              />
            </div>
          </div>

          <ResultsFilterBar
            questions={filterQuestions}
            slotOptions={slotOptions}
            count={responseCountText(matchCount, totalCount)}
          />

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
              <ResponseTable
                lead={[
                  {
                    key: "name",
                    label: `Respondent (${matchCount})`,
                    cell: (r) => (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setOpenId(r.id);
                        }}
                        className="text-left hover:underline"
                      >
                        {r.name}
                      </button>
                    ),
                  },
                  { key: "email", label: "Email", cell: (r) => r.email ?? "—" },
                  {
                    key: "submitted",
                    label: "Submitted",
                    className: "px-4 py-2.5 text-muted-foreground whitespace-nowrap",
                    cell: (r) => (
                      <>
                        {formatDate(r.createdAt)}
                        {r.edited && <span className="ml-1.5 text-xs text-os-grey">Edited</span>}
                      </>
                    ),
                  },
                  ...(hasSlotColumn
                    ? [{ key: "slot", label: "Slot", cell: (r: (typeof rows)[number]) => r.slot ?? "—" }]
                    : []),
                ]}
                columns={columns}
                trailing={
                  isPartnerApplicationForm
                    ? [
                        {
                          key: "partner",
                          label: "Partner app",
                          cell: (r) =>
                            r.partnerApplication ? (
                              <Link
                                to={`/core/partners/applications/${r.partnerApplication.id}`}
                                className="text-xs font-medium text-os-accent hover:underline whitespace-nowrap"
                              >
                                {r.partnerApplication.title} →
                              </Link>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            ),
                        },
                      ]
                    : []
                }
                rows={rows}
                rowKey={(r) => r.id}
                value={(r, key) => r.values.get(key) ?? ""}
                onOpen={(r) => setOpenId(r.id)}
                controls={columnControls}
              />
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

      <ResponseDrawer
        open={selected !== null}
        onClose={() => setOpenId(null)}
        title={selected?.name ?? ""}
        subtitle={selected ? responseSubtitle(selected) : undefined}
        fields={selected?.rows ?? []}
        lead={selected && <PartnerApplicationLink response={selected} />}
        footer={selected && <ResponseDelete response={selected} />}
      />
    </div>
  );
}
