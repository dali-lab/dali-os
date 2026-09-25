// The "sign request goes to whom" line for an agreement activation confirm.
// Turns the resolved audience (null = not enumerable) into a short, honest
// sentence — including the empty-audience case (e.g. a term-group agreement
// before staffing is finalized), which would otherwise silently notify no one.
// Pure + dependency-free so both the agreements console and the Drive-detail
// page can import it client-side.
export function recipientSummary(pendingRecipients: string[] | null): string {
  if (pendingRecipients === null) return "everyone in this agreement's audience";
  const n = pendingRecipients.length;
  if (n === 0) return "no one right now — the audience is empty (is staffing finalized?)";
  const shown = pendingRecipients.slice(0, 8).join(", ");
  const more = n > 8 ? `, +${n - 8} more` : "";
  return `${n} ${n === 1 ? "person" : "people"} (${shown}${more})`;
}
