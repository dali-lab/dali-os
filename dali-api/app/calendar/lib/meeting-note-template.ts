// Client-safe (no node:crypto — a dead import there crashes the client
// bundle). "Hash" here is a deterministic non-cryptographic digest: it only
// ever drives an equality check ("is this note still the untouched
// template?"), never anything security-sensitive, so a real crypto hash would
// just be a heavier way to get the same answer.

/** Collapse whitespace so a trailing newline or a re-saved doc's incidental
 *  reformatting doesn't read as "touched". */
export function normalizeTemplateText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function hashTemplateText(text: string): string {
  // FNV-1a, 32-bit.
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export interface SeededTemplatePage {
  seededFromPageId: string | null;
  seededTemplateHash: string | null;
}

/**
 * True when a note still reads exactly as its seeded template did — nobody
 * has typed over it since attachMeetingNote copied the template in. A note
 * that was never seeded (both fields null) is never "untouched" — there is no
 * template state to compare it to. `currentBodyText` must be extracted the
 * same way the seeding write computed it (normalizeTemplateText over the
 * note's plain text).
 */
export function isUntouchedTemplate(
  page: SeededTemplatePage,
  currentBodyText: string,
): boolean {
  if (!page.seededFromPageId || !page.seededTemplateHash) return false;
  return hashTemplateText(normalizeTemplateText(currentBodyText)) === page.seededTemplateHash;
}
