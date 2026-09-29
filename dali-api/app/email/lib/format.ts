// `"Ada Lovelace" <ada@x.com>` → "Ada Lovelace"; a bare address stays as is.
export function senderName(from: string): string {
  const match = from.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>/);
  if (!match) return from.trim();
  return match[1].trim() || match[2];
}

export function senderAddress(from: string): string {
  return from.match(/<([^>]+)>/)?.[1] ?? from.trim();
}

// Today → time, this year → "Sep 3", older → "9/3/24".
export function shortDate(iso: string, now = new Date()): string {
  const d = new Date(iso);
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
  if (d.getFullYear() === now.getFullYear()) {
    return d.toLocaleDateString([], { month: "short", day: "numeric" });
  }
  return d.toLocaleDateString([], { year: "2-digit", month: "numeric", day: "numeric" });
}

// Small fixed palette so each inbox keeps a recognizable dot across the feed.
const DOTS = ["bg-os-accent", "bg-accent-teal", "bg-accent-coral", "bg-os-amber", "bg-accent-pink", "bg-os-green"];

export function inboxDot(index: number): string {
  return DOTS[index % DOTS.length];
}

// Splits an address header on commas that aren't inside a quoted name.
export function splitAddresses(header: string): string[] {
  return (header.match(/(?:"[^"]*"|[^,])+/g) ?? []).map((s) => s.trim()).filter(Boolean);
}

const COMMON_DOMAINS = ["dartmouth.edu", "dali.dartmouth.edu", "gmail.com"];

// People and domains for recipient autocomplete, drawn from mail already on
// the page — most-seen first.
export function recipientDirectory(headers: string[], ownAddresses: string[]) {
  const people = new Map<string, { name: string; address: string; seen: number }>();
  for (const entry of headers.flatMap(splitAddresses)) {
    const address = senderAddress(entry);
    if (!address.includes("@")) continue;
    const key = address.toLowerCase();
    const name = senderName(entry);
    const existing = people.get(key);
    if (existing) {
      existing.seen++;
      if (!existing.name && name !== address) existing.name = name;
    } else {
      people.set(key, { name: name === address ? "" : name, address, seen: 1 });
    }
  }
  const domainCounts = new Map<string, number>();
  for (const address of [...people.keys(), ...ownAddresses.map((a) => a.toLowerCase())]) {
    const domain = address.split("@")[1];
    if (domain) domainCounts.set(domain, (domainCounts.get(domain) ?? 0) + 1);
  }
  for (const d of COMMON_DOMAINS) if (!domainCounts.has(d)) domainCounts.set(d, 0);
  return {
    people: [...people.values()]
      .sort((a, b) => b.seen - a.seen)
      .map(({ name, address }) => ({ name, address })),
    domains: [...domainCounts.entries()].sort((a, b) => b[1] - a[1]).map(([d]) => d),
  };
}
