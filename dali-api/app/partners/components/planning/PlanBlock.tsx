import { useState, type ReactNode } from "react";
import { useFetcher } from "react-router";
import { Select } from "~/components/ui/floating";
import { Button } from "~/components/ui/Button";
import type { RenewalRole } from "../../lib/partner-renewals";
import { SpotsStepper } from "../SpotsStepper";
import { fetcherError, PLANNING_ACTION } from "./SavedTextField";

export type CoreMember = { userId: string; name: string };
export type DomainOption = { id: string; name: string };

export function sameSpots(a: RenewalRole[], b: RenewalRole[]): boolean {
  const key = (rs: RenewalRole[]) =>
    rs
      .filter((r) => r.slots > 0)
      .map((r) => `${r.domainId}:${r.slots}`)
      .sort()
      .join(",");
  return key(a) === key(b);
}

// One PI + spots block in a planning popup: a project term, a project's last
// term, or an application. `piFields`/`spotsFields` are the form fields each
// save posts to the planning action; null makes that part read-only.
export function PlanBlock({
  title,
  label,
  hint,
  pi,
  spots,
  coreMembers,
  domains,
  canEdit,
  piFields,
  spotsFields,
  saveSpotsLabel,
}: {
  title: ReactNode;
  label: string;
  hint?: string;
  pi: CoreMember | null;
  spots: RenewalRole[];
  coreMembers: CoreMember[];
  domains: DomainOption[];
  canEdit: boolean;
  piFields: Record<string, string> | null;
  spotsFields: Record<string, string> | null;
  saveSpotsLabel?: string;
}) {
  const piFetcher = useFetcher();
  const spotsFetcher = useFetcher();
  const [draft, setDraft] = useState<RenewalRole[]>(spots);
  const savingSpots = spotsFetcher.state !== "idle";
  const error = fetcherError(piFetcher.data) ?? fetcherError(spotsFetcher.data);
  const editSpots = canEdit && spotsFields !== null;
  const dirty = editSpots && !sameSpots(draft, spots);
  const total = spots.reduce((n, s) => n + s.slots, 0);

  const piOptions = [
    { value: "", label: "No PI" },
    ...(pi && !coreMembers.some((m) => m.userId === pi.userId) ? [{ value: pi.userId, label: pi.name }] : []),
    ...coreMembers.map((m) => ({ value: m.userId, label: m.name })),
  ];

  const post = (fetcher: typeof piFetcher, fields: Record<string, string>, extra: Record<string, string>) => {
    const form = new FormData();
    for (const [k, v] of Object.entries({ ...fields, ...extra })) form.set(k, v);
    fetcher.submit(form, { method: "post", action: PLANNING_ACTION });
  };

  return (
    <div className="flex flex-col gap-3 rounded-os-card bg-os-container/40 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-semibold text-foreground">{title}</div>
        <span className="text-xs text-muted-foreground">
          {total} {total === 1 ? "spot" : "spots"}
        </span>
      </div>
      {hint && <p className="-mt-1 text-xs text-muted-foreground">{hint}</p>}

      <div className="grid grid-cols-[minmax(70px,100px)_minmax(0,1fr)] items-center gap-3">
        <span className="text-xs text-muted-foreground">PI</span>
        {canEdit && piFields ? (
          <Select
            ariaLabel={`PI for ${label}`}
            value={pi?.userId ?? ""}
            onChange={(piUserId) => post(piFetcher, piFields, { piUserId })}
            options={piOptions}
          />
        ) : (
          <span className="text-sm text-foreground">
            {pi?.name ?? <span className="italic text-muted-foreground">No PI</span>}
          </span>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-xs text-muted-foreground">Spots per domain</span>
        {editSpots ? (
          <SpotsStepper
            roles={draft}
            domains={domains}
            onChange={setDraft}
            disabled={savingSpots}
            labelPrefix={`${label}: `}
          />
        ) : spots.length === 0 ? (
          <span className="text-sm italic text-muted-foreground">No spots yet</span>
        ) : (
          spots.map((s) => (
            <div key={s.domainId} className="flex justify-between text-sm">
              <span>{s.name}</span>
              <span className="tabular-nums">{s.slots}</span>
            </div>
          ))
        )}
      </div>

      {(dirty || error) && (
        <div className="flex items-center justify-end gap-2">
          {error && <p className="mr-auto text-xs text-destructive">{error}</p>}
          {dirty && spotsFields && (
            <>
              <Button variant="ghost" size="sm" disabled={savingSpots} onClick={() => setDraft(spots)}>
                Cancel
              </Button>
              <Button
                size="sm"
                disabled={savingSpots}
                onClick={() =>
                  post(spotsFetcher, spotsFields, {
                    roles: JSON.stringify(draft.map((r) => ({ domainId: r.domainId, slots: r.slots }))),
                  })
                }
              >
                {savingSpots ? "Saving" : (saveSpotsLabel ?? `Save ${label} spots`)}
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function spotsKey(spots: RenewalRole[]): string {
  return spots.map((s) => `${s.domainId}=${s.slots}`).join(",");
}
