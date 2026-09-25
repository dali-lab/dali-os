import { describe, it, expect } from "vitest";
import {
  resolveCanonicalEmail,
  resolveName,
  collectAddresses,
  groupBySharedAddress,
  isHusk,
  chooseSurvivor,
} from "~/lib/betterauth-linking";

const NO_EMAILS = { email: null, daliEmail: null, dartmouthEmail: null, personalEmail: null };

describe("resolveCanonicalEmail (@dali first)", () => {
  it("prefers daliEmail over the others", () => {
    expect(
      resolveCanonicalEmail({
        daliEmail: "a@dali.dartmouth.edu",
        dartmouthEmail: "a@dartmouth.edu",
        personalEmail: "a@gmail.com",
      }),
    ).toBe("a@dali.dartmouth.edu");
  });

  it("falls back to dartmouth, then personal", () => {
    expect(
      resolveCanonicalEmail({ daliEmail: null, dartmouthEmail: "a@dartmouth.edu", personalEmail: "a@gmail.com" }),
    ).toBe("a@dartmouth.edu");
    expect(
      resolveCanonicalEmail({ daliEmail: null, dartmouthEmail: null, personalEmail: "a@gmail.com" }),
    ).toBe("a@gmail.com");
  });

  it("returns null when there is no address at all", () => {
    expect(resolveCanonicalEmail({ daliEmail: null, dartmouthEmail: null, personalEmail: null })).toBeNull();
  });
});

describe("resolveName", () => {
  it("joins first + last, trimming a missing half", () => {
    expect(resolveName({ firstName: "Ada", lastName: "Lovelace" })).toBe("Ada Lovelace");
    expect(resolveName({ firstName: "Ada", lastName: "" })).toBe("Ada");
  });
});

describe("collectAddresses", () => {
  it("lowercases and gathers every non-null address across all four columns", () => {
    expect(
      collectAddresses({
        email: "A@Dali.Dartmouth.edu",
        daliEmail: "A@Dali.Dartmouth.edu",
        dartmouthEmail: "A@Dartmouth.edu",
        personalEmail: null,
      }),
    ).toEqual(["a@dali.dartmouth.edu", "a@dali.dartmouth.edu", "a@dartmouth.edu"]);
  });
});

describe("groupBySharedAddress", () => {
  it("groups two rows that share an address across different columns", () => {
    const rows = [
      { id: "A", email: "ada@dali.dartmouth.edu", daliEmail: "ada@dali.dartmouth.edu", dartmouthEmail: null, personalEmail: null },
      // B recorded the SAME dali address in its personalEmail column → same person.
      { id: "B", email: null, daliEmail: null, dartmouthEmail: "ada@dartmouth.edu", personalEmail: "ada@dali.dartmouth.edu" },
      { id: "C", ...NO_EMAILS, dartmouthEmail: "someone@dartmouth.edu" },
    ];
    const groups = groupBySharedAddress(rows);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.map((r) => r.id).sort()).toEqual(["A", "B"]);
  });

  it("does not group rows that share no address (the directory-only case)", () => {
    const rows = [
      { id: "A", email: "ada@dali.dartmouth.edu", daliEmail: "ada@dali.dartmouth.edu", dartmouthEmail: null, personalEmail: null },
      { id: "B", email: "ada@dartmouth.edu", daliEmail: null, dartmouthEmail: "ada@dartmouth.edu", personalEmail: null },
    ];
    expect(groupBySharedAddress(rows)).toHaveLength(0);
  });

  it("returns no groups when there are no duplicates", () => {
    const rows = [
      { id: "A", ...NO_EMAILS, daliEmail: "a@dali.dartmouth.edu" },
      { id: "B", ...NO_EMAILS, daliEmail: "b@dali.dartmouth.edu" },
    ];
    expect(groupBySharedAddress(rows)).toHaveLength(0);
  });
});

describe("isHusk", () => {
  it("is a husk only with zero business rows", () => {
    expect(isHusk(0)).toBe(true);
    expect(isHusk(1)).toBe(false);
  });
});

describe("chooseSurvivor", () => {
  const d = (n: number) => new Date(2020, 0, n);

  it("keeps the single non-husk and absorbs the husk", () => {
    const res = chooseSurvivor([
      { row: { id: "member", createdAt: d(2) }, husk: false },
      { row: { id: "google-dup", createdAt: d(5) }, husk: true },
    ]);
    expect(res).not.toBeNull();
    expect(res!.survivor.id).toBe("member");
    expect(res!.duplicates.map((x) => x.id)).toEqual(["google-dup"]);
  });

  it("keeps the oldest when every row is a husk", () => {
    const res = chooseSurvivor([
      { row: { id: "new", createdAt: d(9) }, husk: true },
      { row: { id: "old", createdAt: d(1) }, husk: true },
    ]);
    expect(res!.survivor.id).toBe("old");
    expect(res!.duplicates.map((x) => x.id)).toEqual(["new"]);
  });

  it("refuses (returns null) when two rows both carry real work", () => {
    const res = chooseSurvivor([
      { row: { id: "a", createdAt: d(1) }, husk: false },
      { row: { id: "b", createdAt: d(2) }, husk: false },
    ]);
    expect(res).toBeNull();
  });
});
