import { useMemo, useState } from "react";
import { Combobox, type SelectOption } from "~/components/ui/floating";

export function timeZoneOptions(): SelectOption[] {
  let zones: string[] = [];
  try {
    zones = Intl.supportedValuesOf("timeZone");
  } catch {
    zones = [];
  }
  if (!zones.length) zones = ["America/New_York"];
  return zones.map((tz) => ({ value: tz, label: tz.replace(/_/g, " ") }));
}

export function TimeZoneField({
  name = "timeZone",
  defaultValue,
  className,
}: {
  name?: string;
  defaultValue: string | null;
  className?: string;
}) {
  const [value, setValue] = useState(defaultValue ?? "");
  const options = useMemo(timeZoneOptions, []);
  return (
    <>
      <input type="hidden" name={name} value={value} />
      <Combobox
        value={value}
        options={options}
        onChange={setValue}
        ariaLabel="Time zone"
        placeholder="Choose a time zone"
        className={className}
      />
    </>
  );
}
