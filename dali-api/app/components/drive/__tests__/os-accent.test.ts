import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DROP_OVERLAY, DROP_RING } from "../DriveBrowser";

const src = (f: string) => readFileSync(resolve(__dirname, "..", f), "utf8");

describe("Drive selection, focus and drop states", () => {
  it("draw drop targets in the os accent", () => {
    expect(DROP_RING).toContain("ring-os-accent");
    expect(DROP_OVERLAY).toContain("border-os-accent");
  });

  // Folder and space glyphs (glyphs.ts, scope-icon.tsx) are tinted by audience
  // on purpose and are not covered here.
  it.each(["DriveBrowser.tsx", "DriveHome.tsx", "FolderPicker.tsx"])(
    "%s uses no brand coral for its interaction states",
    (file) => {
      expect(src(file)).not.toContain("accent-coral");
    },
  );
});
