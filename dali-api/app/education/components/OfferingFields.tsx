// Shared field set for the create + edit offering forms. Values are posted as
// plain form fields and parsed server-side in runOfferingAction.
import { useState } from "react";
import { Checkbox } from "~/components/ui/Checkbox";
import { DateField } from "~/components/ui/DateField";
import { ProjectIconPicker } from "~/projects/components/ProjectIconPicker";

import { Select, type SelectOption, Tooltip, InfoTip } from "~/components/ui/floating";
import { APPLICATION_TZ, getZonedParts } from "~/lib/timezone";
import {
  OFFERING_TYPE_DESCRIPTIONS,
  isMultiSession,
  type OfferingType,
} from "~/education/lib/offering-type";

type Values = {
  type?: OfferingType;
  title?: string;
  iconEmoji?: string | null;
  capacity?: number;
  registrationOpensAt?: string | Date;
  registrationClosesAt?: string | Date;
  requiresReview?: boolean;
  calendarEmail?: string | null;
  completionThreshold?: number | null;
};

/**
 * Instant → the `datetime-local` input string (YYYY-MM-DDTHH:mm), rendered in
 * the lab zone (APPLICATION_TZ/ET). The inverse of zonedDateTimeLocalToUtc, so
 * an edit form round-trips to the same wall clock the value was saved with.
 * Zone-explicit (not the host's getHours()) so SSR and client agree — no
 * hydration flip, and re-saving an untouched field doesn't drift the time.
 */
export function toDatetimeLocal(value: string | Date | undefined): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const { year, month, day, hour, minute } = getZonedParts(d, APPLICATION_TZ);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}`;
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
  const [selectedType, setSelectedType] = useState<OfferingType>(
    values.type ?? "Workshop",
  );
  const multiSession = isMultiSession(selectedType);
  // The catalog-card icon. Held in state and posted as a hidden field, since
  // ProjectIconPicker is a controlled popover (no native input of its own).
  const [iconEmoji, setIconEmoji] = useState<string | null>(values.iconEmoji ?? null);

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className={LABEL}>
            <span className="inline-flex items-center gap-1">
              Type
              <InfoTip
                content={`${OFFERING_TYPE_DESCRIPTIONS.Workshop} ${OFFERING_TYPE_DESCRIPTIONS.Miniseries} ${OFFERING_TYPE_DESCRIPTIONS.Fellowship}`}
              />
            </span>
          </span>
          <Tooltip
            content={typeLocked ? "Type can't be changed after an offering is created — it affects how sessions, attendance, and applications are structured." : null}
            variant="rich"
            placement="top"
          >
            <span className="block">
              <Select
                name="type"
                defaultValue={values.type ?? "Workshop"}
                disabled={typeLocked}
                onChange={(v) => setSelectedType(v as OfferingType)}
                options={[
                  { value: "Workshop", label: "Workshop (single session, RSVP)" },
                  { value: "Miniseries", label: "Miniseries (multi-session, reviewed)" },
                  { value: "Fellowship", label: "Fellowship (multi-term, reviewed)" },
                ]}
                buttonClassName={INPUT}
              />
            </span>
          </Tooltip>
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

      <div className="flex items-end gap-3">
        <div className="block">
          <span className={LABEL}>
            <span className="inline-flex items-center gap-1">
              Icon
              <InfoTip content="An emoji shown on the offering's catalog card. Optional — cards fall back to the title's first letter." />
            </span>
          </span>
          <div className="mt-1 flex h-[38px] items-center">
            <ProjectIconPicker iconEmoji={iconEmoji} editing onChange={setIconEmoji} />
          </div>
          <input type="hidden" name="iconEmoji" value={iconEmoji ?? ""} />
        </div>
        <label className="block flex-1">
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
      </div>

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

      {/* Keyed on type so a new offering's default follows the chosen type:
          multi-session offerings are reviewed, workshops auto-approve. */}
      <Checkbox
        key={selectedType}
        name="requiresReview"
        value="true"
        defaultChecked={values.requiresReview ?? multiSession}
        label="Applications need instructor review (uncheck for RSVP auto-approval up to capacity)"
        className="text-sm text-foreground"
      />

      {multiSession && (
        <label className="block">
          <span className={LABEL}>
            <span className="inline-flex items-center gap-1">
              Completion threshold (%)
              <InfoTip content="Students must attend at least this percentage of sessions (excused absences count as attended) to earn a completion certificate. Default is 80%." />
            </span>
          </span>
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
