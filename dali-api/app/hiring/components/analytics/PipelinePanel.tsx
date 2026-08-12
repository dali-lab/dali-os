import { useLocation } from "react-router";
import { CycleSelector } from "./CycleSelector";
import { DomainToggle } from "./DomainToggle";
import { StatusPie, type StatusSlice } from "./StatusPie";
import { ApplicationList, type ApplicationRow } from "./ApplicationList";
import { ConfidentialityGate } from "~/hiring/components/ConfidentialityGate";

// The cycle pipeline — status pie + application drill-down with cycle/domain
// selectors. Used to be the standalone /hiring/analytics page; the hub embeds
// it now, so it renders as a section (h2) under the hub's personal cards.

export type PipelineData = {
  cycles: { id: string; name: string; status: string }[];
  selectedCycleId: string;
  cycleStatus: string;
  accessibleDomains: { id: string; name: string }[];
  selectedDomainId: string | null;
  selectedStatus: string | null;
  slices: StatusSlice[];
  rows: ApplicationRow[];
  confidentialityRequired: null | "no_agreement" | "unsigned";
};

export function PipelinePanel({ data }: { data: PipelineData }) {
  const location = useLocation();

  if (data.cycles.length === 0) {
    return (
      <section className="flex items-center justify-center h-40 text-muted-foreground">
        No hiring cycles found.
      </section>
    );
  }

  const selectedDomainName =
    data.accessibleDomains.find((d) => d.id === data.selectedDomainId)?.name ??
    null;
  const selectedSlice = data.slices.find((s) => s.status === data.selectedStatus);

  const nextParams = new URLSearchParams({ cycleId: data.selectedCycleId });
  if (data.selectedDomainId) nextParams.set("domain", data.selectedDomainId);
  const nextHref = `${location.pathname}?${nextParams.toString()}`;

  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="font-heading text-lg font-bold text-foreground shrink-0">
          Pipeline
        </h2>
        <div className="flex min-w-0 items-center gap-2 sm:justify-end">
          {data.accessibleDomains.length > 1 && (
            <DomainToggle
              domains={data.accessibleDomains}
              selectedDomainId={data.selectedDomainId}
            />
          )}
          <CycleSelector cycles={data.cycles} selectedCycleId={data.selectedCycleId} />
        </div>
      </div>

      {data.confidentialityRequired ? (
        <ConfidentialityGate
          cycleId={data.selectedCycleId}
          reason={data.confidentialityRequired}
          next={nextHref}
        />
      ) : (
        <>
          <div className="bg-card border border-border rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-medium text-muted-foreground">
                Applications by Status
              </h3>
              <span className="text-xs text-muted-foreground">
                Click a slice to filter the list below
              </span>
            </div>
            <StatusPie data={data.slices} selectedStatus={data.selectedStatus} />
          </div>

          <ApplicationList
            rows={data.rows}
            selectedStatusLabel={selectedSlice?.label ?? null}
            selectedDomainName={selectedDomainName}
            exportParams={{
              cycleId: data.selectedCycleId,
              domain: data.selectedDomainId ?? undefined,
              status: data.selectedStatus ?? undefined,
            }}
          />
        </>
      )}
    </section>
  );
}
