/** USD per 1M tokens used for the AI usage page's cost estimate. Not billed figures. */
export const AI_COST_PER_MILLION_TOKENS = { input: 3, output: 15 } as const;

export function estimateAiCost(inputTokens: number, outputTokens: number): number {
  return (
    (inputTokens * AI_COST_PER_MILLION_TOKENS.input +
      outputTokens * AI_COST_PER_MILLION_TOKENS.output) /
    1_000_000
  );
}

export function formatUsd(amount: number): string {
  if (amount > 0 && amount < 0.01) return "<$0.01";
  return amount.toLocaleString("en-US", { style: "currency", currency: "USD" });
}
