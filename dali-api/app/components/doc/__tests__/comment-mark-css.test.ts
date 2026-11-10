import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(__dirname, "..", "theme.css"), "utf8");

function rulesStyling(selectorPart: RegExp) {
  return [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)]
    .flatMap(([, selectors, body]) =>
      selectors
        .split(",")
        .map((s) => s.replace(/\/\*[\s\S]*?\*\//g, "").trim())
        .filter((s) => selectorPart.test(s))
        .map((selector) => ({ selector, body })),
    );
}

describe("comment mark styles", () => {
  const markRules = rulesStyling(/\.bn-thread-mark(?![-\w])/);

  it("styles active comment marks", () => {
    expect(markRules.some((r) => /background-color/.test(r.body))).toBe(true);
  });

  it("leaves the text of a deleted comment unhighlighted", () => {
    for (const { selector, body } of markRules) {
      if (!/background|padding|border-radius|cursor/.test(body)) continue;
      expect(selector).toContain(':not([data-orphan="true"])');
    }
  });
});
