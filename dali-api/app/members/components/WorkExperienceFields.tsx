import { useState } from "react";
import { Select } from "~/components/ui/floating";
import { Checkbox } from "~/components/ui/Checkbox";
import { WORK_MODES } from "~/members/lib/work-experience";

export type WorkExperienceFieldValues = {
  company: string;
  position: string;
  description: string;
  location: string;
  workMode: string;
  startMonth: string;
  endMonth: string;
  current: boolean;
};

const MONTH_OPTIONS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
].map((label, i) => ({ value: String(i + 1).padStart(2, "0"), label }));

// Month + year pickers that read and write one "YYYY-MM" value ("" until both
// are picked). `yearHint` preselects the year when only that is known.
function MonthYearField({
  value,
  onChange,
  label,
  disabled,
  yearHint,
}: {
  value: string;
  onChange: (next: string) => void;
  label: string;
  disabled?: boolean;
  yearHint?: number | null;
}) {
  const [year, month] = value ? value.split("-") : [yearHint ? String(yearHint) : "", ""];
  const [draft, setDraft] = useState({ year, month });
  const thisYear = new Date().getFullYear();
  const years = Array.from({ length: 60 }, (_, i) => String(thisYear - i)).map((y) => ({
    value: y,
    label: y,
  }));
  const set = (patch: Partial<typeof draft>) => {
    const next = { ...draft, ...patch };
    setDraft(next);
    onChange(next.year && next.month ? `${next.year}-${next.month}` : "");
  };
  return (
    <div className="grid grid-cols-2 gap-2">
      <Select
        value={draft.month}
        options={MONTH_OPTIONS}
        ariaLabel={`${label} month`}
        placeholder="Month"
        disabled={disabled}
        onChange={(m) => set({ month: m })}
      />
      <Select
        value={draft.year}
        options={years}
        ariaLabel={`${label} year`}
        placeholder="Year"
        disabled={disabled}
        onChange={(y) => set({ year: y })}
      />
    </div>
  );
}

const fieldLabel = "flex flex-col gap-1.5 text-xs font-semibold text-os-grey";

/** The job form's fields, controlled so the profile modal and the import
 *  review rows share them. Renders named inputs so a surrounding <form> posts
 *  them as-is. */
export function WorkExperienceFields({
  value,
  onChange,
  startYearHint,
  endYearHint,
}: {
  value: WorkExperienceFieldValues;
  onChange: (patch: Partial<WorkExperienceFieldValues>) => void;
  startYearHint?: number | null;
  endYearHint?: number | null;
}) {
  return (
    <>
      <input type="hidden" name="startMonth" value={value.startMonth} />
      <input type="hidden" name="endMonth" value={value.current ? "" : value.endMonth} />
      <input type="hidden" name="workMode" value={value.workMode} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className={fieldLabel}>
          Position
          <input
            name="position"
            type="text"
            required
            value={value.position}
            onChange={(e) => onChange({ position: e.target.value })}
          />
        </label>
        <label className={fieldLabel}>
          Company
          <input
            name="company"
            type="text"
            required
            value={value.company}
            onChange={(e) => onChange({ company: e.target.value })}
          />
        </label>
        <div className={fieldLabel}>
          Start
          <MonthYearField
            label="Start"
            value={value.startMonth}
            yearHint={startYearHint}
            onChange={(startMonth) => onChange({ startMonth })}
          />
        </div>
        <div className={fieldLabel}>
          End
          <MonthYearField
            label="End"
            value={value.endMonth}
            yearHint={endYearHint}
            disabled={value.current}
            onChange={(endMonth) => onChange({ endMonth })}
          />
        </div>
      </div>
      <Checkbox
        tone="os"
        label="I work here now"
        checked={value.current}
        onChange={(e) => onChange({ current: e.target.checked })}
      />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className={fieldLabel}>
          Location
          <input
            name="location"
            type="text"
            placeholder="City, country"
            value={value.location}
            onChange={(e) => onChange({ location: e.target.value })}
          />
        </label>
        <div className={fieldLabel}>
          Work mode
          <Select
            value={value.workMode}
            options={[{ value: "", label: "Not set" }, ...WORK_MODES]}
            ariaLabel="Work mode"
            onChange={(workMode) => onChange({ workMode })}
          />
        </div>
      </div>
      <label className={fieldLabel}>
        Description
        <textarea
          name="description"
          rows={4}
          value={value.description}
          onChange={(e) => onChange({ description: e.target.value })}
          className="resize-y"
        />
      </label>
    </>
  );
}
