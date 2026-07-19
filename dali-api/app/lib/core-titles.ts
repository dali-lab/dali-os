// Distinct Core lead titles for a member's Roles column. Title-less Core
// assignments collapse to a single "Core" pill so a Core member without a
// specific title still shows up (rather than contributing no pill at all).
export function deriveCoreTitles(
  assignments: { leadTitle: string | null }[],
): string[] {
  if (assignments.length === 0) return [];
  const titles = new Set(
    assignments.map((a) => a.leadTitle).filter((t): t is string => !!t),
  );
  const hasUntitled = assignments.some((a) => !a.leadTitle);
  if (hasUntitled) titles.add("Core");
  return Array.from(titles);
}
