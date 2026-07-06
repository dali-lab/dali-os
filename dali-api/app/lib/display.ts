/** "Jane Smith" -> "JS"; "Jane" -> "JA"; "" -> "?". */
export function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

/** Two-letter initials derived from a user object. */
export function userInitials(user: {
  firstName?: string;
  lastName?: string;
  email: string;
}): string {
  if (user.firstName || user.lastName) {
    const fullName = `${user.firstName ?? ""} ${user.lastName ?? ""}`;
    return initialsFromName(fullName);
  }
  const localPart = user.email.split("@")[0] ?? user.email;
  return initialsFromName(localPart);
}

// Sentinel-string policy:
//   UNKNOWN_LABEL ("Unknown") → human prose ("Created by Unknown")
//   EMPTY_DISPLAY ("—")       → table cells / structured data
export const UNKNOWN_LABEL = "Unknown";
export const EMPTY_DISPLAY = "—";

// TODO: import from app-env.ts once available
const DARTMOUTH_EMAIL_DOMAIN_FALLBACK = "dartmouth.edu";

export function fullName(user: { firstName?: string | null; lastName?: string | null }): string {
  return `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim();
}

export function primaryEmail(user: {
  daliEmail?: string | null;
  dartmouthEmail?: string | null;
  personalEmail?: string | null;
}): string | null {
  return user.daliEmail || user.dartmouthEmail || user.personalEmail || null;
}

export function displayEmail(user: {
  daliEmail?: string | null;
  dartmouthEmail?: string | null;
  netId?: string | null;
  personalEmail?: string | null;
}): string {
  const primary = user.daliEmail || user.dartmouthEmail || user.personalEmail;
  if (primary) return primary;
  if (user.netId) return `${user.netId}@${DARTMOUTH_EMAIL_DOMAIN_FALLBACK}`;
  return "";
}

export function formatDateTime(iso: string | Date): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
    + " at " + d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export function formatDateShort(iso: string | Date): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
