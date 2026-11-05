import { Button } from "~/components/ui/Button";
import { MAX_WEEKS, MIN_WEEKS } from "~/education/lib/taskboard/weeks";

export function TermLengthStepper({
  value,
  onChange,
  min = MIN_WEEKS,
  max = MAX_WEEKS,
  disabled = false,
}: {
  value: number;
  onChange: (next: number) => void;
  min?: number;
  max?: number;
  disabled?: boolean;
}) {
  return (
    <span className="inline-flex items-center gap-2">
      <Button
        variant="secondary"
        size="sm"
        aria-label="Fewer weeks"
        disabled={disabled || value <= min}
        onClick={() => onChange(Math.max(min, value - 1))}
      >
        −
      </Button>
      <output className="min-w-[72px] text-center font-semibold text-os-fg">
        {value} {value === 1 ? "week" : "weeks"}
      </output>
      <Button
        variant="secondary"
        size="sm"
        aria-label="More weeks"
        disabled={disabled || value >= max}
        onClick={() => onChange(Math.min(max, value + 1))}
      >
        +
      </Button>
    </span>
  );
}
