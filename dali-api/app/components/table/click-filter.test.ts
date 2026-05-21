import { describe, it, expect } from "vitest";
import { matchesActiveFilters, type ActiveFilter } from "./click-filter";

const f = (column: string, value: string): ActiveFilter => ({
  column,
  value,
  label: value,
});

describe("matchesActiveFilters", () => {
  it("matches any row when there are no active filters", () => {
    expect(matchesActiveFilters([], { status: "Active" })).toBe(true);
    expect(matchesActiveFilters([], {})).toBe(true);
  });

  it("matches a single-value column on exact value", () => {
    const filters = [f("status", "Active")];
    expect(matchesActiveFilters(filters, { status: "Active" })).toBe(true);
    expect(matchesActiveFilters(filters, { status: "Paused" })).toBe(false);
  });

  it("ORs multiple values within the same column", () => {
    const filters = [f("status", "Active"), f("status", "Paused")];
    expect(matchesActiveFilters(filters, { status: "Active" })).toBe(true);
    expect(matchesActiveFilters(filters, { status: "Paused" })).toBe(true);
    expect(matchesActiveFilters(filters, { status: "Archived" })).toBe(false);
  });

  it("ANDs across different columns", () => {
    const filters = [f("status", "Active"), f("partner", "Acme")];
    expect(
      matchesActiveFilters(filters, { status: "Active", partner: ["Acme"] }),
    ).toBe(true);
    // Right status, wrong partner -> excluded.
    expect(
      matchesActiveFilters(filters, { status: "Active", partner: ["Globex"] }),
    ).toBe(false);
    // Right partner, wrong status -> excluded.
    expect(
      matchesActiveFilters(filters, { status: "Paused", partner: ["Acme"] }),
    ).toBe(false);
  });

  it("matches multi-value columns when any entry is wanted", () => {
    const filters = [f("partner", "Acme")];
    expect(
      matchesActiveFilters(filters, { partner: ["Globex", "Acme"] }),
    ).toBe(true);
    expect(matchesActiveFilters(filters, { partner: ["Globex"] })).toBe(false);
  });

  it("treats null/undefined/empty column values as no match", () => {
    const filters = [f("partner", "Acme")];
    expect(matchesActiveFilters(filters, { partner: null })).toBe(false);
    expect(matchesActiveFilters(filters, { partner: undefined })).toBe(false);
    expect(matchesActiveFilters(filters, { partner: [] })).toBe(false);
    expect(matchesActiveFilters(filters, {})).toBe(false);
  });
});
