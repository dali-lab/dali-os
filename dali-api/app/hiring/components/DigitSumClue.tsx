/** Shared digit-line + `+-` easter-egg clue; coral marks digits that sum to the answer plus the `+`. */
export const DIGIT_SUM_CLUE_BODY = "1849273+-";

/** External slot 4: sum of coral-highlighted digits = 1 (`1` only). */
export const DIGIT_SUM_CORAL_EXTERNAL_SLOT4 = new Set<number>([0, 7]);

/** Internal slot 2: sum of coral-highlighted digits = 5 (`2` + `3`). */
export const DIGIT_SUM_CORAL_INTERNAL_SLOT2 = new Set<number>([4, 6, 7]);

export function DigitSumClue({
  slot,
  coralIndices,
  className = "",
}: {
  slot: number;
  coralIndices: ReadonlySet<number>;
  className?: string;
}) {
  const chars = [...DIGIT_SUM_CLUE_BODY];
  return (
    <span className={`font-mono ${className}`.trim()}>
      <span className="text-accent-coral">{slot}</span>
      <span className="text-muted-foreground">:</span>
      {chars.map((ch, i) => (
        <span
          key={i}
          className={coralIndices.has(i) ? "text-accent-coral" : "text-muted-foreground"}
        >
          {ch}
        </span>
      ))}
    </span>
  );
}
