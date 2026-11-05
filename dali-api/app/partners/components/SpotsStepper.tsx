import { Minus, Plus } from "lucide-react";
import { Select } from "~/components/ui/floating";
import { addDomainRole, stepSlots, type RenewalRole } from "../lib/partner-renewals";

export function SpotsStepper({
  roles,
  domains,
  onChange,
  disabled = false,
  labelPrefix = "",
}: {
  roles: RenewalRole[];
  domains: { id: string; name: string }[];
  onChange: (roles: RenewalRole[]) => void;
  disabled?: boolean;
  labelPrefix?: string;
}) {
  const addable = domains.filter((d) => !roles.some((r) => r.domainId === d.id));
  return (
    <div className="flex flex-col gap-1.5">
      {roles.map((r) => (
        <div key={r.domainId} className="flex items-center justify-between gap-2 text-sm">
          <span className="min-w-0 truncate">{r.name}</span>
          <span className="flex items-center gap-1">
            <button
              type="button"
              aria-label={`${labelPrefix}Fewer ${r.name}`}
              className="os-icon-btn"
              disabled={disabled}
              onClick={() => onChange(stepSlots(roles, r.domainId, -1))}
            >
              <Minus className="h-4 w-4" aria-hidden />
            </button>
            <span className="w-6 text-center tabular-nums">{r.slots}</span>
            <button
              type="button"
              aria-label={`${labelPrefix}More ${r.name}`}
              className="os-icon-btn"
              disabled={disabled}
              onClick={() => onChange(stepSlots(roles, r.domainId, 1))}
            >
              <Plus className="h-4 w-4" aria-hidden />
            </button>
          </span>
        </div>
      ))}
      {addable.length > 0 && (
        <Select
          ariaLabel={`${labelPrefix}Add domain`}
          placeholder="+ Domain"
          value={undefined}
          disabled={disabled}
          onChange={(id) => {
            const d = domains.find((x) => x.id === id);
            if (d) onChange(addDomainRole(roles, d.id, d.name));
          }}
          options={addable.map((d) => ({ value: d.id, label: d.name }))}
        />
      )}
    </div>
  );
}
