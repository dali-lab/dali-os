export const PINNED_FIRST_NAMES = ["joyce", "arthur"];

type Person = { id: string; name: string };

const first = (name: string) => name.trim().split(/\s+/)[0]?.toLowerCase() ?? "";

export function orderMembers<T extends Person>(members: T[]): T[] {
  const rank = (m: T) => {
    const i = PINNED_FIRST_NAMES.indexOf(first(m.name));
    return i === -1 ? PINNED_FIRST_NAMES.length : i;
  };
  return members
    .map((m, i) => ({ m, i }))
    .sort((a, b) => rank(a.m) - rank(b.m) || a.i - b.i)
    .map((x) => x.m);
}

export function pinnedMembers<T extends Person>(members: T[], meId: string, selected: string[]): T[] {
  const ordered = orderMembers(members);
  const pinned = ordered.filter((m) => PINNED_FIRST_NAMES.includes(first(m.name)));
  const extra = ordered.filter((m) => !pinned.includes(m) && (m.id === meId || selected.includes(m.id)));
  return [...pinned, ...extra];
}

export function toggleAssignee(selected: string[], id: string): string[] {
  return selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id];
}

export function assigneeNames(ids: string[], members: Person[]): string[] {
  const byId = new Map(members.map((m) => [m.id, m.name]));
  return ids.flatMap((id) => {
    const name = byId.get(id);
    return name ? [name] : [];
  });
}
