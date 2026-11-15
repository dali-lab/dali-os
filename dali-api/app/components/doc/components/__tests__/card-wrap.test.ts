import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const css = readFileSync(resolve(__dirname, "../../theme.css"), "utf8");

const rule = (selector: string) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return css.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? "";
};

describe("component card text", () => {
  it("wraps the card description instead of spilling into the next card", () => {
    expect(rule(".dali-cmp-card .dali-cmp-meta")).toMatch(/white-space:\s*normal/);
  });

  it("lets a card shrink to its grid column and break long words", () => {
    const card = rule(".dali-cmp-card");
    expect(card).toMatch(/min-width:\s*0/);
    expect(card).toMatch(/overflow-wrap:\s*anywhere/);
  });

  it("keeps the links row meta on one line", () => {
    expect(rule(".dali-cmp-meta")).toMatch(/white-space:\s*nowrap/);
  });
});
