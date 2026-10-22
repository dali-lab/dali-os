export type CompletionMode = "percent" | "sessions";

export type CompletionRuleUpdate = {
  completionThreshold?: number;
  completionMinSessions?: number | null;
};

export function parseCompletionRule(formData: FormData): CompletionRuleUpdate {
  const amount = Number(formData.get("completionAmount"));
  if (!Number.isFinite(amount) || amount <= 0) return {};
  if (formData.get("completionMode") === "sessions") {
    return { completionMinSessions: Math.max(1, Math.round(amount)) };
  }
  return {
    completionThreshold: Math.min(100, Math.max(1, amount)) / 100,
    completionMinSessions: null,
  };
}
