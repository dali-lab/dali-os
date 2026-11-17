import { describe, expect, it } from "vitest";
import { parseStatementCsv, parseStatementDate, readStatementHeaders } from "../statement-csv";
import { parseStatementWithFingerprints, rowFingerprint } from "../statement-csv.server";

const map = { date: "Date", merchant: "Description", amount: "Amount" };
const csv = (...lines: string[]) => ["Date,Description,Amount", ...lines].join("\n");

describe("parseStatementDate", () => {
  it.each([
    ["11/17/2026", "2026-11-17"],
    ["1/5/26", "2026-01-05"],
    ["2026-11-17", "2026-11-17"],
    ["2026-11-17T09:30:00Z", "2026-11-17"],
  ])("reads %s", (raw, iso) => expect(parseStatementDate(raw)?.toISOString().slice(0, 10)).toBe(iso));
  it.each(["", "13/40/2026", "Nov 17", "2026-02-31"])("rejects %j", (raw) => expect(parseStatementDate(raw)).toBeNull());
});

describe("parseStatementCsv", () => {
  it("reads headers for the column picker, ignoring a BOM", () => {
    expect(readStatementHeaders("﻿Date,Description,Amount\n1,2,3")).toEqual(["Date", "Description", "Amount"]);
  });
  it("parses common amount shapes", () => {
    const r = parseStatementCsv(
      csv('11/17/2026,GNOMON COPY,"$1,234.56"', "11/18/2026,REFUND,(12.00)", "11/19/2026,STAPLES,-5.25", "2026-11-20,CO-OP,7"),
      map,
    );
    expect(r.errors).toEqual([]);
    expect(r.rows.map((x) => x.amountCents)).toEqual([123456, -1200, -525, 700]);
    expect(r.rows[0].postedAt.toISOString()).toBe("2026-11-17T00:00:00.000Z");
    expect(r.rows[0].rawRow).toEqual({ Date: "11/17/2026", Description: "GNOMON COPY", Amount: "$1,234.56" });
  });
  it("flips the sign when the bank lists charges as negatives", () => {
    const r = parseStatementCsv(csv("11/17/2026,X Shop,-10.00"), { ...map, invertSign: true });
    expect(r.rows[0].amountCents).toBe(1000);
  });
  it("does not support separate debit and credit columns", () => {
    const r = parseStatementCsv("Date,Description,Debit,Credit\n11/17/2026,X,5.00,", { date: "Date", merchant: "Description", amount: "Amount" });
    expect(r.rows).toEqual([]);
    expect(r.errors[0].message).toContain('"Amount"');
  });
  it("reports bad rows and keeps the good ones", () => {
    const r = parseStatementCsv(csv("nope,A,1.00", "11/17/2026,B,abc", "11/17/2026,,1.00", "11/17/2026,Good,1.00"), map);
    expect(r.rows.map((x) => x.merchant)).toEqual(["Good"]);
    expect(r.errors.map((e) => e.line)).toEqual([2, 3, 4]);
  });
  it("skips blank lines", () => {
    expect(parseStatementCsv(csv("", "11/17/2026,A,1.00", ""), map).rows).toHaveLength(1);
  });
  it("numbers identical rows so they stay distinct", () => {
    const r = parseStatementCsv(csv("11/17/2026,A,1.00", "11/17/2026,A,1.00", "11/17/2026,B,1.00"), map);
    expect(r.rows.map((x) => x.ordinal)).toEqual([0, 1, 0]);
  });
});

describe("fingerprints", () => {
  it("is stable across parses and distinct for identical rows", () => {
    const text = csv("11/17/2026,A,1.00", "11/17/2026,A,1.00");
    const a = parseStatementWithFingerprints(text, map).rows.map((r) => r.fingerprint);
    const b = parseStatementWithFingerprints(text, map).rows.map((r) => r.fingerprint);
    expect(a).toEqual(b);
    expect(a[0]).not.toBe(a[1]);
    expect(a[0]).toMatch(/^[0-9a-f]{64}$/);
  });
  it("keeps a row's fingerprint when an overlapping file adds rows after it", () => {
    const first = parseStatementWithFingerprints(csv("11/17/2026,A,1.00"), map).rows[0].fingerprint;
    const second = parseStatementWithFingerprints(csv("11/17/2026,A,1.00", "11/18/2026,B,2.00"), map).rows[0].fingerprint;
    expect(second).toBe(first);
  });
  it("hashes the canonical row and ordinal", () => {
    expect(rowFingerprint("x", 0)).not.toBe(rowFingerprint("x", 1));
    expect(rowFingerprint("x", 0)).toBe(rowFingerprint("x", 0));
  });
});
