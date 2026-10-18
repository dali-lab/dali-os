import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(__dirname, "../..", p), "utf8");

const FILES = [
  "routes/projects.$id.tsx",
  "routes/projects.hub.tsx",
  "routes/projects.$id.public-view.tsx",
  "routes/projects.level-up.tsx",
  "components/ShowcaseDetailList.tsx",
  "components/ShowcaseMediaEditor.tsx",
  "components/ProjectImageBanner.tsx",
  "components/ProjectCoverImage.tsx",
  "components/EpicSprintManager.tsx",
];

describe("project surfaces", () => {
  it.each(FILES)("%s uses no brand coral", (file) => {
    expect(read(file)).not.toContain("accent-coral");
  });

  it.each(FILES)("%s has no hand-rolled white-on-accent primary button", (file) => {
    expect(read(file)).not.toMatch(/bg-os-accent[^"]*text-white|text-white[^"]*bg-os-accent/);
  });
});
