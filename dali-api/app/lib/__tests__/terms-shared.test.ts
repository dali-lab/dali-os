import { describe, expect, it } from "vitest";
import { ALL_TERMS, termFilterOrder, type TermOption } from "~/lib/terms.shared";

// sortKey-desc, the order resolveTermFilter hands back.
const TERMS: TermOption[] = [
  { id: "t-26w", code: "26W" },
  { id: "t-25f", code: "25F", isCurrent: true },
  { id: "t-25x", code: "25X" },
  { id: "t-25s", code: "25S" },
];

describe("termFilterOrder", () => {
  it("leads with All terms, then the current term, then older ones", () => {
    expect(termFilterOrder(TERMS).map((o) => o.label)).toEqual([
      "All terms",
      "25F",
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
});
