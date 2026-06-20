// Shared @-mention parsing + rendering utilities. Pure (no Prisma, no React)
// so they can be used from client components, server loaders, and
// notification helpers alike. Scope-specific candidate loaders live in
// `lib/mentions.server.ts`.
//
// Mention syntax: `@firstname` or `@firstname-lastname` (case-insensitive,
// dash-separated). Resolution rules:
//   - Exact (normalize(firstName) + normalize(lastName)) match wins.
//   - Otherwise: firstName-only match if exactly one candidate matches.
//   - Otherwise: silently ignored at resolution time (still chip-styled
//     visually since the renderer just regex-matches).
// Normalization strips non-alphanumeric characters and lowercases.

export const MENTION_RE = /@([a-zA-Z][a-zA-Z0-9-]{0,40})/g;

export interface Candidate {
  id: string;
  firstName: string | null;
  lastName: string | null;
}

export interface MentionMatch {
  raw: string;        // including the leading @
  handle: string;     // without @
  userId: string;
  displayName: string;
}

/**
 * Extract unique lowercase handles referenced in `body`. Order-preserving.
 */
export function extractHandles(body: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of body.matchAll(MENTION_RE)) {
    const handle = m[1].toLowerCase();
    if (!seen.has(handle)) {
      seen.add(handle);
      out.push(handle);
    }
  }
  return out;
}

/**
 * Resolve the handles in `body` against a candidate list. Same userId
 * resolved twice collapses to one match. Returns matches only for handles
 * that uniquely resolve to a candidate.
 */
export function resolveMentions(body: string, candidates: Candidate[]): MentionMatch[] {
  const handles = extractHandles(body);
  if (handles.length === 0) return [];
  const out: MentionMatch[] = [];
  const seenIds = new Set<string>();
  for (const handle of handles) {
    const match = pickCandidate(handle, candidates);
    if (!match || seenIds.has(match.id)) continue;
    seenIds.add(match.id);
    out.push({
      raw: `@${handle}`,
      handle,
      userId: match.id,
      displayName: displayNameOf(match) || handle,
    });
  }
  return out;
}

export function pickCandidate(handle: string, candidates: Candidate[]): Candidate | null {
  const h = handle.toLowerCase();
  const composite = h.replace(/-/g, "");
  // Exact firstName-lastName composite match.
  for (const c of candidates) {
    if (normalize(c.firstName) + normalize(c.lastName) === composite) return c;
  }
  // Otherwise: firstName-only match if unique.
  const firstOnly = candidates.filter((c) => normalize(c.firstName) === h);
  if (firstOnly.length === 1) return firstOnly[0];
  return null;
}

export interface Segment {
  type: "text" | "mention";
  text: string;
  userId?: string;
}

/**
 * Split body into text + mention segments for SSR-friendly rendering.
 * Pass an empty `resolved` array to render every regex-matched handle as a
 * chip (no userId), useful when the renderer doesn't need real resolution.
 */
export function segmentBody(body: string, resolved: MentionMatch[]): Segment[] {
  const byRaw = new Map<string, MentionMatch>();
  for (const m of resolved) byRaw.set(m.raw.toLowerCase(), m);

  const out: Segment[] = [];
  let lastIndex = 0;
  const re = new RegExp(MENTION_RE.source, "g");
  let match: RegExpExecArray | null;
  while ((match = re.exec(body)) !== null) {
    const raw = match[0];
    if (match.index > lastIndex) {
      out.push({ type: "text", text: body.slice(lastIndex, match.index) });
    }
    const lookup = byRaw.get(raw.toLowerCase());
    out.push({
      type: "mention",
      text: lookup ? `@${lookup.displayName}` : raw,
      userId: lookup?.userId,
    });
    lastIndex = match.index + raw.length;
  }
  if (lastIndex < body.length) {
    out.push({ type: "text", text: body.slice(lastIndex) });
  }
  return out.length > 0 ? out : [{ type: "text", text: body }];
}

function normalize(s: string | null | undefined): string {
  return (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function displayNameOf(c: Candidate): string {
  return `${c.firstName ?? ""} ${c.lastName ?? ""}`.trim();
}
