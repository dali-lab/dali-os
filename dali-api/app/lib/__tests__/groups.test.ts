import { describe, it, expect } from "vitest";
import { isGroupArchived } from "../groups";

const NOW = new Date("2026-05-24T00:00:00Z");

// Two terms: 26W has ended, 26S is still running as of NOW.
const ended = new Date("2026-03-01T00:00:00Z");
const running = new Date("2026-06-15T00:00:00Z");
const termEnds = new Map([
  ["26W", ended],
  ["26S", running],
]);

describe("isGroupArchived", () => {
  it("is archived when manually archived, regardless of terms", () => {
    expect(
      isGroupArchived({ archivedAt: new Date("2026-01-01"), boundTermIds: [] }, termEnds, NOW),
    ).toBe(true);
    // Manual archive overrides a still-running bound term.
    expect(
      isGroupArchived({ archivedAt: new Date("2026-01-01"), boundTermIds: ["26S"] }, termEnds, NOW),
    ).toBe(true);
  });

  it("is not archived when ongoing (no archive, no bound terms)", () => {
    expect(isGroupArchived({ archivedAt: null, boundTermIds: [] }, termEnds, NOW)).toBe(false);
  });

  it("auto-archives once the only bound term has ended", () => {
    expect(isGroupArchived({ archivedAt: null, boundTermIds: ["26W"] }, termEnds, NOW)).toBe(true);
  });

  it("stays active while a bound term is still running", () => {
    expect(isGroupArchived({ archivedAt: null, boundTermIds: ["26S"] }, termEnds, NOW)).toBe(false);
  });

  it("uses the latest bound term: active until the last term ends", () => {
    // Bound to both an ended and a running term — the running one keeps it active.
    expect(
      isGroupArchived({ archivedAt: null, boundTermIds: ["26W", "26S"] }, termEnds, NOW),
    ).toBe(false);
  });

  it("ignores unknown (deleted) term ids; falls back to not-archived if all unknown", () => {
    expect(
      isGroupArchived({ archivedAt: null, boundTermIds: ["gone"] }, termEnds, NOW),
    ).toBe(false);
    // A known-ended term still archives even alongside an unknown id.
    expect(
      isGroupArchived({ archivedAt: null, boundTermIds: ["gone", "26W"] }, termEnds, NOW),
    ).toBe(true);
  });
});
