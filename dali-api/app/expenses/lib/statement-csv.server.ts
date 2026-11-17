import { createHash } from "node:crypto";
import { parseStatementCsv, type StatementMapping, type StatementParseResult, type StatementRowDraft } from "./statement-csv";

export type StatementRow = StatementRowDraft & { fingerprint: string };

export function rowFingerprint(canonical: string, ordinal: number): string {
  return createHash("sha256").update(`${canonical}:${ordinal}`).digest("hex");
}

export function parseStatementWithFingerprints(
  csvText: string,
  mapping: StatementMapping,
): Omit<StatementParseResult, "rows"> & { rows: StatementRow[] } {
  const parsed = parseStatementCsv(csvText, mapping);
  return {
    ...parsed,
    rows: parsed.rows.map((r) => ({ ...r, fingerprint: rowFingerprint(r.canonical, r.ordinal) })),
  };
}
