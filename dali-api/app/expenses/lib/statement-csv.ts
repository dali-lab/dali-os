import Papa from "papaparse";
import { parseMoneyToCents } from "./money";

export type StatementMapping = {
  date: string;
  merchant: string;
  amount: string;
  invertSign?: boolean;
};

export type StatementRowDraft = {
  postedAt: Date;
  merchant: string;
  amountCents: number;
  rawRow: Record<string, string>;
  canonical: string;
  ordinal: number;
};

export type StatementParseResult = {
  headers: string[];
  rows: StatementRowDraft[];
  errors: { line: number; message: string }[];
};

export function parseStatementDate(raw: string): Date | null {
  const s = raw.trim();
  let y: number, m: number, d: number;
  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/.exec(s);
  if (match) {
    [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  } else if ((match = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(s))) {
    m = Number(match[1]);
    d = Number(match[2]);
    y = Number(match[3]);
    if (match[3].length === 2) y += 2000;
  } else {
    return null;
  }
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return date;
}

function readTable(csvText: string) {
  return Papa.parse<Record<string, string>>(csvText.replace(/^﻿/, ""), {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.trim(),
  });
}

export function readStatementHeaders(csvText: string): string[] {
  return (readTable(csvText).meta.fields ?? []).filter((h) => h !== "");
}

export function parseStatementCsv(csvText: string, mapping: StatementMapping): StatementParseResult {
  const table = readTable(csvText);
  const headers = (table.meta.fields ?? []).filter((h) => h !== "");
  const errors: StatementParseResult["errors"] = [];
  for (const col of [mapping.date, mapping.merchant, mapping.amount]) {
    if (!headers.includes(col)) {
      errors.push({ line: 1, message: `Column "${col}" isn't in the file.` });
    }
  }
  if (errors.length) return { headers, rows: [], errors };

  const seen = new Map<string, number>();
  const rows: StatementRowDraft[] = [];
  table.data.forEach((record, i) => {
    const line = i + 2;
    const rawRow: Record<string, string> = {};
    for (const h of headers) rawRow[h] = (record[h] ?? "").trim();
    const postedAt = parseStatementDate(rawRow[mapping.date]);
    const cents = parseMoneyToCents(rawRow[mapping.amount]);
    const merchant = rawRow[mapping.merchant];
    if (!postedAt) return void errors.push({ line, message: `Couldn't read the date "${rawRow[mapping.date]}".` });
    if (cents === null) return void errors.push({ line, message: `Couldn't read the amount "${rawRow[mapping.amount]}".` });
    if (!merchant) return void errors.push({ line, message: "The merchant is empty." });
    const canonical = JSON.stringify(headers.map((h) => rawRow[h]));
    const ordinal = seen.get(canonical) ?? 0;
    seen.set(canonical, ordinal + 1);
    rows.push({
      postedAt,
      merchant,
      amountCents: mapping.invertSign ? -cents : cents,
      rawRow,
      canonical,
      ordinal,
    });
  });
  return { headers, rows, errors };
}
