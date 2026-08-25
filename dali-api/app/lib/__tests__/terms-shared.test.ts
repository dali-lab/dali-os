import { describe, expect, it } from "vitest";
import { ALL_TERMS, UPCOMING, termFilterOrder, type TermOption } from "~/lib/terms.shared";

// sortKey-desc, the order resolveTermFilter hands back.
const TERMS: TermOption[] = [
  { id: "t-26w", code: "26W" },
  { id: "t-25f", code: "25F", isCurrent: true },
  { id: "t-25x", code: "25X" },
  { id: "t-25s", code: "25S" },
];

describe("termFilterOrder", () => {
  it("leads with All terms, then the current term (labelled), then older ones", () => {
    expect(termFilterOrder(TERMS).map((o) => o.label)).toEqual([
      "All terms",
      "25F · current",
      "26W",
      "25X",
      "25S",
    ]);
  });

  it("uses the ALL_TERMS sentinel for the first option", () => {
    expect(termFilterOrder(TERMS)[0].value).toBe(ALL_TERMS);
  });

  it("never lists the current term twice", () => {
    const ids = termFilterOrder(TERMS).map((o) => o.value);
    expect(ids.filter((v) => v === "t-25f")).toHaveLength(1);
  });

  it("falls back to plain sortKey order when no term is current", () => {
    const noCurrent = TERMS.map(({ id, code }) => ({ id, code }));
    expect(termFilterOrder(noCurrent).map((o) => o.label)).toEqual([
      "All terms",
      "26W",
      "25F",
      "25X",
      "25S",
    ]);
  });

  it("handles an empty term list", () => {
    expect(termFilterOrder([])).toEqual([{ value: ALL_TERMS, label: "All terms" }]);
  });

  it("prepends Current & upcoming when opted in, ahead of All terms", () => {
    const opts = termFilterOrder(TERMS, { includeUpcoming: true });
    expect(opts.slice(0, 2)).toEqual([
      { value: UPCOMING, label: "Current & upcoming" },
      { value: ALL_TERMS, label: "All terms" },
    ]);
  });

  it("omits All terms for a mandatory single-term switcher", () => {
    const opts = termFilterOrder(TERMS, { includeAll: false });
    expect(opts.map((o) => o.value)).not.toContain(ALL_TERMS);
    expect(opts[0]).toEqual({ value: "t-25f", label: "25F · current" });
  });
});
