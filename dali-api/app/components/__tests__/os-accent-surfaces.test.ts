import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(__dirname, "../..", p), "utf8");

// Shell pages that used to hand-roll coral buttons and links.
const FILES = [
  "hiring/components/RubricDetail.tsx",
  "signing/components/SigningDocumentDetail.tsx",
  "signing/components/AgreementsConsole.tsx",
  "admin/routes/admin.announcements.tsx",
];

describe("shell surfaces", () => {
  it.each(FILES)("%s uses no brand coral", (file) => {
    expect(read(file)).not.toContain("accent-coral");
  });

  it.each(FILES)("%s has no hand-rolled white-on-fill primary button", (file) => {
    expect(read(file)).not.toMatch(/text-white[^"]*bg-os-accent|bg-os-accent[^"]*text-white/);
  });
});
