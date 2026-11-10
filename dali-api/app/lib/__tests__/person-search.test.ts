import { describe, expect, it } from "vitest";
import { matchesAllWords, searchWords, userTextWhere } from "~/lib/person-search";

describe("searchWords", () => {
  it("splits on any whitespace, lowercases, and drops empties", () => {
    expect(searchWords("  Ada \t LOVELACE ")).toEqual(["ada", "lovelace"]);
  });

  it("caps at four words", () => {
    expect(searchWords("a b c d e f")).toEqual(["a", "b", "c", "d"]);
  });

  it("returns nothing for a blank query", () => {
    expect(searchWords("   ")).toEqual([]);
  });
});

describe("userTextWhere", () => {
  it("requires every word to match one of the fields", () => {
    expect(userTextWhere("Ada Lovelace", ["firstName", "lastName"])).toEqual({
      AND: [
        {
          OR: [
            { firstName: { contains: "ada", mode: "insensitive" } },
            { lastName: { contains: "ada", mode: "insensitive" } },
          ],
        },
        {
          OR: [
            { firstName: { contains: "lovelace", mode: "insensitive" } },
            { lastName: { contains: "lovelace", mode: "insensitive" } },
          ],
        },
      ],
    });
  });

  it("appends per-word extra clauses", () => {
    const where = userTextWhere("ada", ["firstName"], (w) => [{ coreAssignments: { some: { leadTitle: { contains: w } } } }]);
    expect(where).toEqual({
      AND: [
        {
          OR: [
            { firstName: { contains: "ada", mode: "insensitive" } },
            { coreAssignments: { some: { leadTitle: { contains: "ada" } } } },
          ],
        },
      ],
    });
  });
});

describe("matchesAllWords", () => {
  it.each(["Ada Lovelace", "ada lovelace", "Lovelace Ada", "Ada L", "ADA"])("matches %s", (q) => {
    expect(matchesAllWords("Ada Lovelace", q)).toBe(true);
  });

  it("rejects when any word is missing", () => {
    expect(matchesAllWords("Ada Lovelace", "Ada Byron")).toBe(false);
  });
});
