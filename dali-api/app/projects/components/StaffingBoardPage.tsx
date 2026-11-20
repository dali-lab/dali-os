import { useMemo, useState, type ComponentProps, type ReactNode } from "react";
import { useFilteredList } from "~/hooks/useFilteredList";
import { useSearchParamState } from "~/hooks/useSearchParamState";
import { Button } from "~/components/ui/Button";
import { SearchInput } from "~/components/ui/SearchInput";
import { TermFilter } from "~/components/TermFilter";
import { useOsChrome } from "~/components/os-chrome";
import { ColumnFilters, useColumnFilters } from "~/projects/components/ColumnFilters";
import { BoardCsvLink, BoardTable, type BoardRow } from "~/projects/components/BoardTable";
import { BoardSettings } from "~/projects/components/BoardSettings";
import { AddResponseDialog } from "~/projects/components/AddResponseDialog";
import { DomainFilter } from "~/projects/components/DomainFilter";
import type { Slot } from "~/projects/lib/form-slots";
import type { SlotBoardLoad } from "~/projects/lib/slot-board-page.server";
import type { ResolvedRow } from "~/projects/lib/submission-view.server";

type Row = ResolvedRow & BoardRow;

function Header({ label }: { label: string }) {
  const { pageTitle } = useOsChrome();
  return (
    <header className="flex items-start justify-between gap-3">
      <h1 className={pageTitle}>{label}</h1>
    </header>
  );
}

export function StaffingBoardPage<R extends Row>({
  data,
  slot,
  label,
  emptyLabel,
  tableProps,
  children,
}: {
  data: SlotBoardLoad<R>;
  slot: Slot;
  label: string;
  emptyLabel: string;
  tableProps?: Pick<ComponentProps<typeof BoardTable<R>>, "trailing" | "drawerFooter">;
  children?: ReactNode;
}) {
  if (data.gate === "no-cycle") {
    return (
      <div className="flex flex-col gap-4">
        <Header label={label} />
        <p className="text-sm text-muted-foreground">No active staffing term right now.</p>
      </div>
    );
  }
  return (
    <Loaded data={data} slot={slot} label={label} emptyLabel={emptyLabel} tableProps={tableProps}>
      {children}
    </Loaded>
  );
}

function Loaded<R extends Row>({
  data,
  slot,
  label,
  emptyLabel,
  tableProps,
  children,
}: {
  data: Extract<SlotBoardLoad<R>, { gate: "ok" }>;
  slot: Slot;
  label: string;
  emptyLabel: string;
  tableProps?: Pick<ComponentProps<typeof BoardTable<R>>, "trailing" | "drawerFooter">;
  children?: ReactNode;
}) {
  const [domainId, setDomainId] = useSearchParamState("domain");
  const [search, setSearch] = useSearchParamState("q", { debounceMs: 300 });
  const columnFilters = useColumnFilters(data.tableColumns, [], { inUrl: true });
  const [adding, setAdding] = useState(false);

  const { filtered } = useFilteredList(data.submissions, {
    search,
    searchFields: (s) => [s.name, s.email],
    predicates: [(s) => !domainId || s.domainIds.includes(domainId), columnFilters.predicate],
    deps: [domainId, columnFilters.active],
  });

  const domains = useMemo(
    () => data.domainOptions.map((d) => ({ id: d.id, name: d.displayName })),
    [data.domainOptions],
  );

  return (
    <div className="flex flex-col gap-4">
      <Header label={label} />

      {!data.isAll && (
        <BoardSettings
          slotLabel={label}
          binding={data.binding}
          forms={data.selectableForms}
          canManage={data.canManage}
        />
      )}

      {adding && data.cycle.id && (
        <AddResponseDialog
          cycleId={data.cycle.id}
          slot={slot}
          slotLabel={label}
          onClose={() => setAdding(false)}
        />
      )}

      {data.mappingWarning && (
        <div className="rounded-md border border-os-amber/40 bg-os-amber/10 px-3 py-2 text-sm text-os-amber">
          <span className="font-medium">Heads up:</span> {data.mappingWarning} Submissions are still
          recorded; affected columns just won’t feed staffing until you fix the mapping.
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <SearchInput
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name or email"
          aria-label="Search submissions"
          containerClassName="flex-1 min-w-[200px] max-w-[420px]"
        />
        <TermFilter terms={data.termOptions} selected={data.selectedTerm} />
        <DomainFilter domains={domains} value={domainId} onChange={setDomainId} />
        <div className="min-w-[220px] flex-1">
          <ColumnFilters
            columns={data.tableColumns}
            rows={data.submissions}
            filters={columnFilters.filters}
            onChange={columnFilters.setFilters}
            shownCount={filtered.length}
          />
        </div>
        {!data.noFormConnected && (
          <BoardCsvLink slot={slot} matching={filtered.length} total={data.submissions.length} />
        )}
        {data.canManage && data.cycle.id && data.binding && (
          <Button variant="secondary" size="sm" className="h-8" onClick={() => setAdding(true)}>
            Add response
          </Button>
        )}
      </div>

      <div className="overflow-hidden rounded-os-card bg-os-card">
        {data.noFormConnected ? (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">
            Connect a form from the ⋯ menu above so members can submit.
          </div>
        ) : (
          <BoardTable
            columns={data.tableColumns}
            addable={data.addableColumns}
            roleChoices={data.roleChoices}
            rows={filtered}
            editable={data.canManage && !data.isAll}
            canDelete={data.canManage && !data.isAll}
            {...tableProps}
            emptyMessage={
              data.submissions.length === 0
                ? `No ${emptyLabel} submissions yet.`
                : "No members match the current filters."
            }
          />
        )}
      </div>

      {children}
    </div>
  );
}
