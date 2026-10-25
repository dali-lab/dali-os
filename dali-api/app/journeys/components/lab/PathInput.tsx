import { useEffect, useRef, useState } from "react";

export function PathInput({
  prefix = "",
  defaultValue = "",
  placeholder,
  depth,
  validate,
  onSubmit,
  onCancel,
}: {
  prefix?: string;
  defaultValue?: string;
  placeholder?: string;
  depth: number;
  validate: (value: string) => string | null;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(defaultValue);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  const submit = () => {
    const problem = validate(value);
    if (problem) {
      setError(problem);
      return;
    }
    onSubmit(value);
  };

  return (
    <div style={{ paddingLeft: depth * 12 + 8 }} className="py-1 pr-2">
      <div className="flex items-center rounded-md border border-os-accent bg-os-bg px-2 font-mono text-xs">
        {prefix && <span className="shrink-0 text-os-muted">{prefix}</span>}
        <input
          ref={ref}
          type="text"
          value={value}
          placeholder={placeholder}
          aria-label="File path"
          aria-invalid={Boolean(error)}
          spellCheck={false}
          onChange={(e) => {
            setValue(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            }
            if (e.key === "Escape") {
              // Keep Escape from also closing the fullscreen editor around us.
              e.preventDefault();
              onCancel();
            }
          }}
          onBlur={onCancel}
          className="h-7 min-w-0 flex-1 bg-transparent text-foreground outline-none placeholder:text-os-muted"
        />
      </div>
      {error && <p className="mt-1 text-[11px] text-destructive">{error}</p>}
    </div>
  );
}
