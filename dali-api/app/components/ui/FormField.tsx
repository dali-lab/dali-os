import { cn } from "~/lib/cn";
import { useOsChrome } from "~/components/os-chrome";

/** A labelled text input or textarea. Sits inside an `.os-form` container, which dresses the control. */
export function FormField({
  label,
  value,
  onChange,
  placeholder,
  hint,
  multiline = false,
  rows = 3,
  mono = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  hint?: string;
  multiline?: boolean;
  rows?: number;
  mono?: boolean;
}) {
  const { fieldLabel } = useOsChrome();
  const control = cn("w-full", mono && "font-mono text-[13px]", multiline && "resize-y leading-6");
  return (
    <label className={fieldLabel}>
      <span>{label}</span>
      {multiline ? (
        <textarea
          rows={rows}
          value={value}
          placeholder={placeholder}
          spellCheck={!mono}
          onChange={(e) => onChange(e.target.value)}
          className={control}
        />
      ) : (
        <input type="text" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} className={control} />
      )}
      {hint && <span className="text-xs text-os-muted">{hint}</span>}
    </label>
  );
}
