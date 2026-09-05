import type { RoleInstance } from "~/lib/roles";
import { Tooltip } from "~/components/ui/floating";
import { Select } from "~/components/ui/floating";
import { useOsChrome } from "~/components/os-chrome";
import { cn } from "~/lib/cn";
import { roleColor } from "~/calendar/lib/event-block";

// The add-entry row mixes a date input, two time inputs, a select and a
// textarea. Each of those sizes itself from its own intrinsic content — the
// native date/time widgets and the select spinner all differ, and by locale —
// so equal padding does not produce equal heights. Pin them instead.
export const FIELD_BASE = "h-9 px-2 text-sm border";

// Overlay-by-default, toggle-to-narrow chip row above the Timesheet grid —
// mirrors SubCalendarRow's toggle-chip pattern but is a pure client-side
// filter (no server round-trip): excludedKeys tracks which buckets are
// hidden, so a fresh page load with no interaction shows everything overlaid.
export function RoleFilterRow({
  buckets,
  excludedKeys,
  onToggle,
}: {
  buckets: { key: string; label: string; hours: number }[];
  excludedKeys: Set<string>;
  onToggle: (key: string) => void;
}) {
  // Single-bucket weeks still get the row: the chip doubles as this week's
  // per-role hours readout, which is useful even when there's nothing to
  // filter against.
  if (buckets.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5 px-1 pb-2">
      {buckets.map((b) => {
        const active = !excludedKeys.has(b.key);
        const color = roleColor(b.key);
        return (
          <Tooltip key={b.key} content={`${b.label} — ${b.hours.toFixed(2)} hrs this week${active ? "" : " (hidden)"}`}>
            <button
              type="button"
              onClick={() => onToggle(b.key)}
              aria-pressed={active}
              className={`flex items-center gap-1.5 px-2 py-1 rounded-full border text-xs transition-colors ${
                active
                  ? "border-border bg-muted/60 text-foreground"
                  : "border-border/50 text-muted-foreground opacity-50"
              }`}
            >
              <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: color.dot }} />
              {b.label}
              <span className={active ? "text-muted-foreground" : ""}>· {b.hours.toFixed(2)}h</span>
            </button>
          </Tooltip>
        );
      })}
    </div>
  );
}

// Encodes a RoleInstance into a single <select> option value (assignmentType
// and roleRefId travel together — see calendar-schemas.ts's assignmentType).
export function roleOptionKey(role: Pick<RoleInstance, "assignmentType" | "roleRefId">): string {
  return `${role.assignmentType}:${role.roleRefId}`;
}

export function parseRoleOptionKey(
  key: string,
): { assignmentType: RoleInstance["assignmentType"]; roleRefId: string } | null {
  if (!key) return null;
  const idx = key.indexOf(":");
  if (idx < 0) return null;
  return {
    assignmentType: key.slice(0, idx) as RoleInstance["assignmentType"],
    roleRefId: key.slice(idx + 1),
  };
}

// Role picker for a plain (non-fetch, name-attribute-driven) <Form> — pairs a
// controlled <select> with hidden assignmentType/roleRefId inputs so native
// FormData submission carries both halves of the encoded role key.
// Controlled by the parent so submit can be gated on a role actually being
// picked (the disabled placeholder below is not a submittable choice).
export function RoleSelectField({
  id,
  myRoles,
  value,
  onChange,
}: {
  id: string;
  myRoles: RoleInstance[];
  value: string;
  onChange: (next: string) => void;
}) {
  const { fieldLabel, compactField } = useOsChrome();
  const parsed = parseRoleOptionKey(value);
  return (
    <label htmlFor={id} className={fieldLabel}>
      Role
      <Select
        value={value}
        onChange={onChange}
        placeholder="Select a role…"
        options={myRoles.map((r) => ({ value: roleOptionKey(r), label: r.label }))}
        buttonClassName={cn(
          FIELD_BASE,
          compactField,
          value ? "border-border" : "border-red-500",
          "inline-flex items-center justify-between gap-1 transition-colors hover:bg-muted/40",
        )}
      />
      <input type="hidden" name="assignmentType" value={parsed?.assignmentType ?? ""} />
      <input type="hidden" name="roleRefId" value={parsed?.roleRefId ?? ""} />
    </label>
  );
}
