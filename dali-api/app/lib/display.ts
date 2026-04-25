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
