import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useFetcher, useSearchParams } from "react-router";
import { SearchInput } from "~/components/ui/SearchInput";
import { PagerLinks } from "~/components/ui/Pager";
import { Modal, ModalHeader } from "~/components/Modal";
import type {
  ResponseRow,
  VersionResponses,
} from "~/forms/lib/version-responses.server";
import { modalCardClass } from "~/components/os-chrome";
import { Button } from "~/components/ui/Button";
import { useConfirmSubmit } from "~/components/ui/dialog";
import { FormTracker } from "~/forms/components/FormTracker";
import { ExportCsvLink } from "~/forms/components/ResultsControls";
import { ResultsFilterBar, responseCountText, useAnswerFilters } from "~/forms/components/ResultsFilterBar";
import type { TrackerCounts } from "~/forms/lib/form-tracker";
import { MultiSelect } from "~/components/ui/floating";
import { ChevronDown } from "lucide-react";
import { ResponseTable, type ColumnControls } from "~/forms/components/ResponseTable";
import {
  MEMBER_COLUMNS_PARAM,
  MEMBER_HISTORY_COLUMNS,
  parseMemberColumns,
} from "~/projects/lib/member-history";
import { useFeatureFlag } from "~/components/FeatureFlags";

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
              {row.files?.length ? (
                <span className="flex flex-col gap-1">
                  {row.files.map((f) => (
                    <a
                      key={f.key}
                      href={`/api/upload/raw?key=${encodeURIComponent(f.key)}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-os-accent hover:underline break-all"
                    >
                      {f.name}
                    </a>
                  ))}
                </span>
              ) : (
                row.value || "—"
              )}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function ResponseDelete({ response }: { response: ResponseRow }) {
  const fetcher = useFetcher<{ ok?: true; error?: string }>();
  const confirmSubmit = useConfirmSubmit();
  if (response.deleteBlocked) {
    return (
      <p className="mt-6 text-xs text-muted-foreground">
        This response can't be deleted. {response.deleteBlocked}
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

function MemberColumnsPicker() {
  const [searchParams, setSearchParams] = useSearchParams();
  return (
    <MultiSelect
      ariaLabel="Member columns"
      values={parseMemberColumns(searchParams)}
      options={MEMBER_HISTORY_COLUMNS.map((c) => ({ value: c.key, label: c.label }))}
      onChange={(next) =>
        setSearchParams(
          (prev) => {
            const params = new URLSearchParams(prev);
            const keys = MEMBER_HISTORY_COLUMNS.map((c) => c.key).filter((k) => next.includes(k));
            if (keys.length) params.set(MEMBER_COLUMNS_PARAM, keys.join(","));
            else params.delete(MEMBER_COLUMNS_PARAM);
            return params;
          },
          { replace: true, preventScrollReset: true },
        )
      }
      chips={false}
      renderTrigger={({ chosen }) => (
        <>
          <span className="truncate">
            Member columns{chosen.length > 0 ? ` (${chosen.length})` : ""}
          </span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        </>
      )}
    />
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
  const canAddColumns = useFeatureFlag("form-response-views");
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
              {!canAddColumns && <MemberColumnsPicker />}
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
                controls={canAddColumns ? columnControls : null}
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
