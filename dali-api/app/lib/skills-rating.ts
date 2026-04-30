export const SKILLS_RATING_UNRATED = "-";

export function parseSkillsRating(value: string | undefined | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!value) return out;
  for (const line of value.split("\n")) {
    const idx = line.lastIndexOf(":");
    if (idx > 0) {
      const skill = line.slice(0, idx).trim();
      const rating = line.slice(idx + 1).trim();
      if (skill) out[skill] = rating;
    }
  }
  return out;
}

export function isSkillsRatingComplete(
  value: string | undefined | null,
  skills: string[],
): boolean {
  if (skills.length === 0) return true;
  const ratings = parseSkillsRating(value);
  return skills.every(s => /^[0-5]$/.test(ratings[s] ?? ""));
}
