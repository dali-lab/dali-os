// Shared field set for the create + edit offering forms. Values are posted as
// plain form fields and parsed server-side in runOfferingAction.
import { useState } from "react";
import { Checkbox } from "~/components/ui/Checkbox";
import { DateField } from "~/components/ui/DateField";

import { Select, type SelectOption } from "~/components/ui/floating";

type Values = {
  type?: "Miniseries" | "Workshop";
  title?: string;
  capacity?: number;
  registrationOpensAt?: string | Date;
  registrationClosesAt?: string | Date;
  requiresReview?: boolean;
  calendarEmail?: string | null;
  completionThreshold?: number | null;
};

/** Date → the local `datetime-local` input format (YYYY-MM-DDTHH:mm). */
export function toDatetimeLocal(value: string | Date | undefined): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const LABEL = "text-xs font-semibold text-muted-foreground";
const INPUT =
  "mt-1 w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-teal";

export function OfferingFields({
  values = {},
  typeLocked = false,
}: {
  values?: Values;
  typeLocked?: boolean;
}) {
  // Track type locally so the threshold field can show/hide reactively when
  // the type selector changes on the create form (edit locks the type).
  const [selectedType, setSelectedType] = useState<"Miniseries" | "Workshop">(
    values.type ?? "Workshop",
  );
  const isMiniseries = selectedType === "Miniseries";

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className={LABEL}>Type</span>
          <Select
            name="type"
            defaultValue={values.type ?? "Workshop"}
            disabled={typeLocked}
            onChange={(v) => setSelectedType(v as "Miniseries" | "Workshop")}
            options={[
              { value: "Workshop", label: "Workshop (single session, RSVP)" },
              { value: "Miniseries", label: "Miniseries (multi-session, reviewed)" },
            ]}
            buttonClassName={INPUT}
          />
        </label>
        <label className="block">
          <span className={LABEL}>Capacity</span>
          <input
            type="number"
            name="capacity"
            min={1}
            required
            defaultValue={values.capacity ?? 20}
            className={INPUT}
          />
        </label>
      </div>

      <label className="block">
        <span className={LABEL}>Title</span>
        <input
          type="text"
          name="title"
          required
          defaultValue={values.title ?? ""}
          placeholder="e.g. Full-Stack Miniseries 26F"
          className={INPUT}
        />
      </label>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className={LABEL}>Registration opens</span>
          <DateField
            mode="datetime-local"
            name="registrationOpensAt"
            required
            defaultValue={toDatetimeLocal(values.registrationOpensAt)}
            className="w-full"
            ariaLabel="Registration opens"
          />
        </label>
        <label className="block">
          <span className={LABEL}>Registration closes</span>
          <DateField
            mode="datetime-local"
            name="registrationClosesAt"
            required
            defaultValue={toDatetimeLocal(values.registrationClosesAt)}
            className="w-full"
            ariaLabel="Registration closes"
          />
        </label>
      </div>
      <p className="text-xs text-muted-foreground">
        Course start and end dates are set automatically from the sessions you add.
      </p>

      <Checkbox
        name="requiresReview"
        value="true"
        defaultChecked={values.requiresReview ?? false}
        label="Applications need instructor review (uncheck for RSVP auto-approval up to capacity)"
        className="text-sm text-foreground"
      />

      {isMiniseries && (
        <label className="block">
          <span className={LABEL}>Completion threshold (%)</span>
          <input
            type="number"
            name="completionThresholdPct"
            min={1}
            max={100}
            defaultValue={Math.round((values.completionThreshold ?? 0.8) * 100)}
            className={INPUT}
          />
          <p className="mt-1 text-xs text-muted-foreground">
            Students must attend this percentage of sessions (including excused) to earn a
            certificate. Default is 80%.
          </p>
        </label>
      )}
    </>
  );
}
