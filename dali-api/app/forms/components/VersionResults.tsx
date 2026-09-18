import { useMemo, useState } from "react";
import { Link } from "react-router";
import { Download } from "lucide-react";
import { SearchInput } from "~/components/ui/SearchInput";
import { Select, Tooltip } from "~/components/ui/floating";
import { Modal, ModalHeader } from "~/components/Modal";
import type {
  ResponseRow,
  VersionResponses,
} from "~/forms/lib/version-responses.server";

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
          to={`/partners/applications/${response.partnerApplication.id}`}
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

// One version's responses: a table of submissions (newest 200) with a detail
// modal, a slot filter when staffing fills are present, and CSV export of the
// full set for this version.
export function VersionResults({
  formId,
  versionNumber,
  results,
}: {
  formId: string;
  versionNumber: number;
  results: VersionResponses;
}) {
  const {
    isPartnerApplicationForm,
    totalCount,
    columns,
    slotOptions,
    responses,
  } = results;
  const [query, setQuery] = useState("");
  const [slot, setSlot] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  const rows = useMemo(
    () =>
      responses.map((r) => ({
        ...r,
        values: new Map(r.rows.map((row) => [row.key, row.value])),
      })),
    [responses],
  );

  const filteredRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (slot && r.slot !== slot) return false;
      if (q && !`${r.name} ${r.email ?? ""}`.toLowerCase().includes(q))
        return false;
      return true;
    });
  }, [rows, query, slot]);

  const selected = responses.find((r) => r.id === openId) ?? null;
  const hasSlotColumn = slotOptions.length > 0;

  return (
    <div className="space-y-4">
      {isPartnerApplicationForm && (
        <Link
          to="/partners/applications"
          className="block bg-os-accent/10 rounded-os-item px-4 py-3 text-sm text-os-accent font-medium hover:bg-os-accent/15 transition"
        >
          These responses are partner applications. Review them on the
          Partner Applications board →
        </Link>
      )}

      {totalCount === 0 ? (
        <div className="text-center py-12 rounded-os-card bg-os-card">
          <p className="text-sm text-muted-foreground">
            No responses to v{versionNumber} yet.
          </p>
        </div>
      ) : (
        <>
          <div className="flex flex-col sm:flex-row sm:items-center gap-2">
            <span className="text-sm text-os-grey">
              {totalCount} {totalCount === 1 ? "response" : "responses"}
              {totalCount > responses.length &&
                ` · showing the ${responses.length} most recent`}
            </span>
            {hasSlotColumn && (
              <Select
                ariaLabel="Filter by slot"
                value={slot}
                onChange={(v) => setSlot(v)}
                placeholder="All slots"
                options={[
                  { value: "", label: "All slots" },
                  ...slotOptions.map((s) => ({ value: s, label: s })),
                ]}
                buttonClassName="px-3 py-1.5 text-sm border border-os-container rounded-full bg-os-well text-foreground sm:w-48 inline-flex items-center justify-between gap-1 transition-colors hover:border-os-container-hi"
              />
            )}
            <SearchInput
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name or email"
              aria-label="Search responses by name or email"
              size="sm"
              containerClassName="w-full sm:ml-auto sm:w-64 min-w-[12rem]"
            />
            <Tooltip content="Export every response to this version as CSV">
              <a
                href={`/forms/responses/${formId}/export.csv?version=${versionNumber}`}
                download
                aria-label="Export CSV"
                className="inline-flex items-center justify-center p-2 rounded-full border border-os-container text-os-grey hover:text-foreground hover:border-os-container-hi transition-colors"
              >
                <Download className="w-4 h-4" />
              </a>
            </Tooltip>
          </div>

          <div className="rounded-os-card bg-os-card overflow-hidden">
            {filteredRows.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                No responses match the current filters.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[640px]">
                  <thead className="text-os-grey text-xs uppercase tracking-wide">
                    <tr>
                      <th className="text-left font-medium px-4 py-3">
                        Respondent ({filteredRows.length}
                        {filteredRows.length === rows.length
                          ? ""
                          : ` of ${rows.length}`}
                        )
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
                    {filteredRows.map((r) => (
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
                                to={`/partners/applications/${r.partnerApplication.id}`}
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
        </>
      )}

      <Modal
        open={selected !== null}
        onClose={() => setOpenId(null)}
        labelledBy="response-detail-title"
        containerClassName="bg-card rounded-2xl shadow-brand-2 max-w-2xl w-full p-5 sm:p-6 my-auto max-h-[85vh] overflow-y-auto"
      >
        {selected && (
          <>
            <ModalHeader
              titleId="response-detail-title"
              title={selected.name}
              subtitle={[
                selected.email,
                formatTimestamp(selected.createdAt),
                selected.slot,
                selected.submitterIp && `IP ${selected.submitterIp}`,
              ]
                .filter(Boolean)
                .join(" · ")}
              onClose={() => setOpenId(null)}
            />
            <ResponseDetailBody response={selected} />
          </>
        )}
      </Modal>
    </div>
  );
}
