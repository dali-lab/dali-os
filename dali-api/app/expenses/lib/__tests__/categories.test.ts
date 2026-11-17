import { describe, expect, it } from "vitest";
import { suggestCategory, type CategoryHints } from "../categories";

const cats: CategoryHints[] = [
  { id: "tech", label: "Technigala", hints: ["gala", "poster", "certificate"] },
  { id: "work", label: "Workshops", hints: ["workshop", "speaker"] },
  { id: "prog", label: "General and socials", hints: ["social", "pizza"] },
  { id: "old", label: "Retired", hints: ["poster"], archivedAt: new Date() },
];
const input = (over = {}) => ({
  poRefs: [],
  lineItems: [],
  merchants: [],
  categories: cats,
  card: null,
  ...over,
});

describe("suggestCategory", () => {
  it("reads the PO first", () => {
    expect(suggestCategory(input({ poRefs: ["Technigala Nov 26 part3"] }))).toEqual({
      categoryId: "tech",
      reason: "PO says Technigala",
    });
  });
  it("prefers the PO over line items", () => {
    const s = suggestCategory(input({ poRefs: ["Workshop supplies"], lineItems: ["Poster 18x12"] }));
    expect(s?.categoryId).toBe("work");
  });
  it("falls back to line items with the matching hint", () => {
    expect(suggestCategory(input({ lineItems: ["Posters 18.5x12.4"] }))).toEqual({
      categoryId: "tech",
      reason: "Line items mention poster",
    });
  });
  it("falls back to the merchant", () => {
    expect(suggestCategory(input({ merchants: ["Joe's Pizza"] }))?.reason).toBe("Merchant matches pizza");
  });
  it("matches at word starts only", () => {
    expect(suggestCategory(input({ lineItems: ["Sposter"] }))).toBeNull();
  });
  it("ignores archived categories", () => {
    expect(suggestCategory(input({ categories: [cats[3]], lineItems: ["poster"] }))).toBeNull();
  });
  it("skips a tier where two categories tie", () => {
    const s = suggestCategory(input({ poRefs: ["poster workshop"], card: { nickname: "Programs Visa", defaultCategoryId: "prog" } }));
    expect(s).toEqual({ categoryId: "prog", reason: "Default for Programs Visa" });
  });
  it("uses the card default when the receipt says nothing", () => {
    expect(suggestCategory(input({ card: { nickname: "Programs Visa", defaultCategoryId: "work" } }))).toEqual({
      categoryId: "work",
      reason: "Default for Programs Visa",
    });
  });
  it("does not offer an archived or missing card default", () => {
    expect(suggestCategory(input({ card: { nickname: "X", defaultCategoryId: "old" } }))).toBeNull();
    expect(suggestCategory(input({ card: { nickname: "X", defaultCategoryId: null } }))).toBeNull();
  });
  it("suggests nothing for an unknown receipt", () => {
    expect(suggestCategory(input({ lineItems: ["Cables"] }))).toBeNull();
  });
});
