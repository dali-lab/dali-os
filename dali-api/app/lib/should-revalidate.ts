import type { ShouldRevalidateFunctionArgs } from "react-router";

/**
 * Skips loader revalidation for a same-path GET navigation whose search-param
 * changes are all client-only. Any param in `serverParams` that changed, any
 * mutation, and any navigation that does not change the query string defer to
 * the router default.
 */
export function skipClientOnlySearchChange(
  { currentUrl, nextUrl, formMethod, defaultShouldRevalidate }: ShouldRevalidateFunctionArgs,
  serverParams: readonly string[],
): boolean {
  if (formMethod && formMethod.toUpperCase() !== "GET") return defaultShouldRevalidate;
  if (currentUrl.pathname !== nextUrl.pathname) return defaultShouldRevalidate;
  if (currentUrl.search === nextUrl.search) return defaultShouldRevalidate;
  for (const key of serverParams) {
    const a = currentUrl.searchParams.getAll(key);
    const b = nextUrl.searchParams.getAll(key);
    if (a.length !== b.length || a.some((v, i) => v !== b[i])) return defaultShouldRevalidate;
  }
  return false;
}
