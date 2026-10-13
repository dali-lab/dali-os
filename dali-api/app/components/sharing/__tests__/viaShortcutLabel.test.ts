import { describe, expect, it } from "vitest";
import { viaShortcutLabel } from "~/components/sharing/ShareDialog";

describe("viaShortcutLabel", () => {
  it("names the folder the shortcut sits in", () => {
    expect(viaShortcutLabel({ folderTitle: "Check-ins" })).toBe("via shortcut in Check-ins");
  });

  it("drops the folder for a shortcut at a workspace's top level", () => {
    expect(viaShortcutLabel({ folderTitle: null })).toBe("via shortcut");
  });
});
