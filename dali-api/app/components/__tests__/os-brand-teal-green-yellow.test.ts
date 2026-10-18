import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(__dirname, "../..", p), "utf8");

describe("status meanings use the os status tokens", () => {
  it.each([
    ["education/components/RosterMatrix.tsx", "text-os-green"],
    ["education/routes/education.tsx", 'success: "bg-os-green"'],
    ["members/components/ComplianceBlock.tsx", "bg-os-green/10"],
    ["members/components/MemberProfileView.tsx", '"bg-os-green"'],
    ["admin/components/PayrollUploadModal.tsx", "text-os-green"],
    ["projects/components/FinalizeModal.tsx", 'text-os-green">{savedNote}'],
    ["partners/routes/partner.settings.tsx", "text-os-green bg-os-green/10"],
  ])("%s marks success with os-green", (file, needle) => {
    expect(read(file)).toContain(needle);
  });

  it("colours task mention dots with the task board's own status edges", () => {
    const src = read("components/doc/schema/TaskMentionHoverCard.tsx");
    for (const s of ["backlog", "todo", "progress", "review", "done", "cancelled"]) {
      expect(src).toContain(`var(--os-status-${s}-edge)`);
    }
    expect(src).not.toMatch(/accent-(teal|green|yellow)/);
  });

  it("draws unread counts in the accent with page-colour text", () => {
    expect(read("email/components/UnreadBadge.tsx")).toContain("bg-os-accent px-1.5");
    expect(read("email/components/UnreadBadge.tsx")).toContain("text-os-bg");
  });
});

// Links, selection, loaders and progress: the accent. Category colours
// (priority P2, achievement kinds, partner-visible audience teal, portal
// domain rotation, classic status palettes) are intentionally not listed.
describe("interactive chrome uses the os accent", () => {
  it.each([
    "routes/help.getting-started.tsx",
    "components/settings/CalendarSettingsBlock.tsx",
    "components/doc/schema/mention.tsx",
    "components/NavigationProgress.tsx",
    "components/TabWorkspace.tsx",
    "routes/attendance.tsx",
    "partners/routes/partner.home.tsx",
  ])("%s uses no brand teal, green or yellow", (file) => {
    expect(read(file)).not.toMatch(/accent-(teal|green|yellow)(?!-light)|grad-teal/);
  });
});
