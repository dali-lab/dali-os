// Client-safe rules for the note that sits above an application.

export const HIRING_NOTE_MAX = 2000;

/** Who may write the note: the people who run the cycle. Core cycles hold
 *  current members' applications, so there it narrows to Admin. */
export function canEditHiringNote(
  roles: { isAdmin: boolean; isCore: boolean; isDomainLead: boolean },
  isCoreCycle: boolean,
): boolean {
  return roles.isAdmin || (!isCoreCycle && (roles.isCore || roles.isDomainLead));
}

/** What to store for a submitted note: trimmed text, or null to remove it. */
export function normalizeHiringNote(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const text = raw.trim().slice(0, HIRING_NOTE_MAX);
  return text === "" ? null : text;
}
