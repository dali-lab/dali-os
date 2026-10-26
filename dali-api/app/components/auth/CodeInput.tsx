import { useEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent } from "react";
import { cn } from "~/lib/cn";

const LENGTH = 6;

/** Six single-digit boxes over one hidden `name` field, so the surrounding
 *  <Form> posts the joined code exactly as the old single input did. Typing
 *  advances, Backspace retreats, paste (and iOS one-time-code autofill, which
 *  lands as a multi-digit change) fills the row, and a complete code submits
 *  the form on its own. */
export function CodeInput({
  name,
  invalid,
  disabled,
}: {
  name: string;
  invalid: boolean;
  disabled: boolean;
}) {
  const [value, setValue] = useState("");
  const refs = useRef<Array<HTMLInputElement | null>>([]);

  useEffect(() => {
    refs.current[0]?.focus();
  }, []);

  const setDigits = (next: string) => {
    const clean = next.replace(/\D/g, "").slice(0, LENGTH);
    setValue(clean);
    refs.current[Math.min(clean.length, LENGTH - 1)]?.focus();
    if (clean.length === LENGTH) {
      // Let React commit the hidden input's value before the form reads it.
      requestAnimationFrame(() => refs.current[0]?.form?.requestSubmit());
    }
  };

  const handleInput = (index: number, raw: string) => {
    const digits = raw.replace(/\D/g, "");
    if (!digits) return;
    // More than one digit means paste or OTP autofill — take the whole code.
    if (digits.length > 1) return setDigits(digits);
    const chars = value.split("");
    chars[index] = digits;
    setDigits(chars.join("").slice(0, Math.max(index + 1, value.length)));
  };

  const handleKey = (index: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace") {
      e.preventDefault();
      const target = value[index] ? index : index - 1;
      if (target < 0) return;
      setValue(value.slice(0, target) + value.slice(target + 1));
      refs.current[target]?.focus();
    } else if (e.key === "ArrowLeft") {
      refs.current[index - 1]?.focus();
    } else if (e.key === "ArrowRight") {
      refs.current[index + 1]?.focus();
    }
  };

  const handlePaste = (e: ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    setDigits(e.clipboardData.getData("text"));
  };

  return (
    <div className="flex justify-between gap-2" role="group" aria-label="6-digit code">
      <input type="hidden" name={name} value={value} />
      {Array.from({ length: LENGTH }, (_, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="text"
          inputMode="numeric"
          autoComplete={i === 0 ? "one-time-code" : "off"}
          disabled={disabled}
          aria-label={`Digit ${i + 1}`}
          aria-invalid={invalid}
          value={value[i] ?? ""}
          onChange={(e) => handleInput(i, e.target.value)}
          onKeyDown={(e) => handleKey(i, e)}
          onPaste={handlePaste}
          onFocus={(e) => e.target.select()}
          style={{ animationDelay: `${80 + i * 35}ms` }}
          className={cn(
            "h-14 w-full min-w-0 rounded-xl border-2 bg-card text-center font-heading text-2xl font-bold text-dark-blue outline-none transition-[border-color,box-shadow,background-color] duration-150 focus:ring-2 focus:ring-accent-coral motion-safe:animate-auth-digit disabled:bg-brand-tint",
            invalid ? "border-red-400" : value[i] ? "border-dark-blue" : "border-border hover:border-dark-blue/40",
          )}
        />
      ))}
    </div>
  );
}
