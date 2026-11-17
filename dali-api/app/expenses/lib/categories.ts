export type CategoryHints = {
  id: string;
  label: string;
  hints: readonly string[];
  archivedAt?: Date | string | null;
};

export type SuggestionInput = {
  poRefs: readonly string[];
  lineItems: readonly string[];
  merchants: readonly string[];
  categories: readonly CategoryHints[];
  card?: { nickname: string; defaultCategoryId: string | null } | null;
};

export type CategorySuggestion = { categoryId: string; reason: string };

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function mentions(text: string, term: string): boolean {
  const t = term.trim();
  if (!t) return false;
  return new RegExp(`(^|[^a-z0-9])${escape(t.toLowerCase())}`, "i").test(text.toLowerCase());
}

function bestInTier(
  texts: readonly string[],
  categories: readonly CategoryHints[],
): { category: CategoryHints; hint: string } | null {
  const joined = texts.join(" \n ");
  if (!joined.trim()) return null;
  const scored = categories
    .map((category) => {
      const terms = [category.label, ...category.hints];
      const hit = terms.filter((t) => mentions(joined, t));
      return { category, hint: hit[0] ?? "", score: hit.length };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);
  if (scored.length === 0) return null;
  if (scored.length > 1 && scored[0].score === scored[1].score) return null;
  return scored[0];
}

export function suggestCategory(input: SuggestionInput): CategorySuggestion | null {
  const active = input.categories.filter((c) => !c.archivedAt);

  const po = bestInTier(input.poRefs, active);
  if (po) return { categoryId: po.category.id, reason: `PO says ${po.category.label}` };

  const items = bestInTier(input.lineItems, active);
  if (items) return { categoryId: items.category.id, reason: `Line items mention ${items.hint}` };

  const merchant = bestInTier(input.merchants, active);
  if (merchant) return { categoryId: merchant.category.id, reason: `Merchant matches ${merchant.hint}` };

  const fallback = input.card?.defaultCategoryId;
  if (input.card && fallback && active.some((c) => c.id === fallback)) {
    return { categoryId: fallback, reason: `Default for ${input.card.nickname}` };
  }
  return null;
}
