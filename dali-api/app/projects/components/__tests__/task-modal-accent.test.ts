import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const src = readFileSync(resolve(__dirname, "../TaskModal.tsx"), "utf8");

describe("TaskModal", () => {
  it("uses no brand coral", () => {
    expect(src).not.toContain("accent-coral");
  });

  it("shows errors in the destructive colour, not a link colour", () => {
    for (const name of ["linkError", "artifactError", "commentsError", "commentPostError", "saveError"]) {
      expect(src).toMatch(new RegExp(`className="(text-xs )?text-destructive">\\{${name}\\}`));
    }
  });
});
