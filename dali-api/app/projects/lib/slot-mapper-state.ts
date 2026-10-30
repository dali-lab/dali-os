export function sameDraftCols<T extends { uid: string }>(a: T[], b: T[]): boolean {
  const strip = (cs: T[]) => JSON.stringify(cs.map(({ uid: _uid, ...rest }) => rest));
  return strip(a) === strip(b);
}

export type MappingSaveStatus =
  | { tone: "muted"; text: string }
  | { tone: "warn"; text: string }
  | { tone: "ok"; text: string }
  | null;

export function mappingSaveStatus(input: { saving: boolean; dirty: boolean; result: unknown }): MappingSaveStatus {
  if (input.saving) return null;
  if (input.dirty) return { tone: "warn", text: "Unsaved changes" };
  const r = input.result as { ok?: unknown; synced?: unknown; failed?: unknown } | null | undefined;
  if (!r || r.ok !== true) return null;
  const failed = typeof r.failed === "number" ? r.failed : 0;
  if (failed > 0) {
    return { tone: "warn", text: `Saved. ${failed} ${failed === 1 ? "response has a status" : "responses have statuses"} the mapping can't read.` };
  }
  if (typeof r.synced === "number") {
    return { tone: "ok", text: `Saved. ${r.synced} ${r.synced === 1 ? "response" : "responses"} updated.` };
  }
  return { tone: "ok", text: "Saved" };
}
