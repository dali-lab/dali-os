// Pure label helpers for challenge/rubric version pickers.
// Server-side derivation of ChallengeVersion.versionNumber lives in the
// loaders that consume this — see admin.cycle.$id.tsx and domain-lead.tsx.

export interface VersionLabelInput {
  name: string;
  versionNumber?: number | null;
  createdAt?: Date | string | null;
  createdBy?: { firstName: string | null; lastName: string | null } | null;
}

export function formatCreator(
  createdBy: { firstName: string | null; lastName: string | null } | null | undefined,
): string | null {
  if (!createdBy) return null;
  const first = createdBy.firstName?.trim() ?? "";
  const last = createdBy.lastName?.trim() ?? "";
  if (!first && !last) return null;
  if (first && last) return `${first} ${last[0]!.toUpperCase()}.`;
  return first || last;
}

export function formatVersionLabel(opts: VersionLabelInput): string {
  const parts: string[] = [opts.name || "Untitled"];
  if (opts.versionNumber != null) parts.push(`v${opts.versionNumber}`);
  if (opts.createdAt) {
    const d = typeof opts.createdAt === "string" ? new Date(opts.createdAt) : opts.createdAt;
    if (!isNaN(d.getTime())) parts.push(d.toLocaleDateString());
  }
  const creator = formatCreator(opts.createdBy ?? null);
  if (creator) parts.push(`by ${creator}`);
  return parts.join(" — ");
}

/**
 * Group a flat list of challenge versions by `challengeId` and assign a
 * 1-based versionNumber per family ordered by `createdAt` ascending.
 *
 * Pass the *full* version family for any challenge whose versions you need
 * numbered — passing only a subset (e.g. only versions for one domain) will
 * produce ranks that don't match the canonical history if a challenge has
 * versions outside the subset.
 */
export function buildVersionNumberMap<T extends { id: string; challengeId: string; createdAt: Date | string }>(
  versions: T[],
): Map<string, number> {
  const sorted = [...versions].sort((a, b) => {
    const ta = typeof a.createdAt === "string" ? new Date(a.createdAt).getTime() : a.createdAt.getTime();
    const tb = typeof b.createdAt === "string" ? new Date(b.createdAt).getTime() : b.createdAt.getTime();
    return ta - tb;
  });
  const counters = new Map<string, number>();
  const result = new Map<string, number>();
  for (const v of sorted) {
    const next = (counters.get(v.challengeId) ?? 0) + 1;
    counters.set(v.challengeId, next);
    result.set(v.id, next);
  }
  return result;
}
