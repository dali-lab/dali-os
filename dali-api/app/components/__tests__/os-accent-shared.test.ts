import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(__dirname, "../..", p), "utf8");

const FILES = [
  "components/editor/ManagedEditorShell.tsx",
  "components/collab/VersionHistoryPanel.tsx",
  "components/TabWorkspace.tsx",
  "components/TagPicker.tsx",
  "components/PhotoCropModal.tsx",
  "components/FilePreview.tsx",
  "components/doc/schema/MentionHoverCard.tsx",
  "components/MonthCalendarPanel.tsx",
  "components/activities/ActivityLauncher.tsx",
  "members/components/NoteShareModal.tsx",
  "routes/link.tsx",
  "routes/documents.file.$fileId.tsx",
  "components/infra/ProjectInfraView.tsx",
];

describe("shared shell components", () => {
  // accent-coral-light is an event category fill (MonthCalendarPanel), not an accent.
  it.each(FILES)("%s uses no brand coral accent", (file) => {
    expect(read(file)).not.toMatch(/accent-coral(?!-light)/);
  });

  it.each(FILES)("%s has no hand-rolled white-on-accent button", (file) => {
    expect(read(file)).not.toMatch(/bg-os-accent[^"]*text-white|text-white[^"]*bg-os-accent/);
  });
});
