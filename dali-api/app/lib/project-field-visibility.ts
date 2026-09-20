// Which project fields only Core may see, and how to strip the rest.
//
// Hiding an edit control is not the same as not sending the value. The project
// detail loader returns one object to every viewer and the page decides what to
// render, so a field gated only in JSX still ships in the payload to anyone who
// can open the project. This module is the server-side half of that gate.
//
// Client-safe on purpose (no Prisma import): the loader calls it, and its test
// runs in CI without a generated Prisma client.

/**
 * Fields redacted from the project detail payload for non-Core viewers.
 *
 * Chart strings are the first entries because they're Dartmouth payroll GL
 * codes — the same reasoning that keeps them out of `get_project_settings`.
 * Add a field here rather than gating it in a component.
 */
export const CORE_ONLY_PROJECT_FIELDS = [
  "chartString",
  "chartStringType",
] as const;

export type CoreOnlyProjectField = (typeof CORE_ONLY_PROJECT_FIELDS)[number];

/**
 * Null out the Core-only fields unless the viewer may see them.
 *
 * Nulls rather than deletes: the loader's return type is what React Router
 * infers the client-side type from, so dropping keys conditionally would make
 * the payload shape depend on the viewer. Every field in the list is already
 * nullable for the "not set yet" case, so null reads the same way downstream.
 */
export function redactCoreOnlyProjectFields<T extends object>(
  project: T,
  canSeeFinance: boolean,
): T {
  if (canSeeFinance) return project;

  const redacted = { ...project } as Record<string, unknown>;
  for (const field of CORE_ONLY_PROJECT_FIELDS) {
    if (field in redacted) redacted[field] = null;
  }
  return redacted as T;
}
