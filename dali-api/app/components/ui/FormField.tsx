import { cn } from "~/lib/cn";
import { useOsChrome } from "~/components/os-chrome";

/** A labelled text input or textarea. Sits inside an `.os-form` container, which dresses the control. Controlled via `value`/`onChange`, or uncontrolled via `name`/`defaultValue` inside a form. */
export function FormField({
  label,
  labelHidden = false,
  value,
  onChange,
  name,
  defaultValue,
  required,
  type = "text",
  placeholder,
  hint,
  multiline = false,
  rows = 3,
  mono = false,
  onKeyDown,
}: {
  label: string;
  labelHidden?: boolean;
  value?: string;
  onChange?: (value: string) => void;
  name?: string;
  defaultValue?: string;
  required?: boolean;
  type?: "text" | "email" | "url";
  placeholder?: string;
  hint?: string;
  multiline?: boolean;
  rows?: number;
  mono?: boolean;
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
}) {
  const { fieldLabel } = useOsChrome();
  const control = cn("w-full", mono && "font-mono text-[13px]", multiline && "resize-y leading-6");
  const shared = {
    name,
    required,
    placeholder,
    className: control,
    ...(onChange ? { value: value ?? "", onChange: (e: { target: { value: string } }) => onChange(e.target.value) } : { defaultValue }),
  };
  return (
    <label className={fieldLabel}>
      <span className={labelHidden ? "sr-only" : undefined}>{label}</span>
      {multiline ? (
        <textarea rows={rows} spellCheck={!mono} onKeyDown={onKeyDown} {...shared} />
      ) : (
        <input type={type} {...shared} />
      )}
      {hint && <span className="text-xs text-os-muted">{hint}</span>}
    </label>
  );
}
