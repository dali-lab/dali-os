import { describe, it, expect } from "vitest";
import { labMeetingNoteDefaultOptions, templateToggleLabel } from "../template-menu";

describe("labMeetingNoteDefaultOptions", () => {
  it("offers project and other notebooks, not meeting types", () => {
    expect(labMeetingNoteDefaultOptions(null)).toEqual([
      { value: "none", label: "No default" },
      { value: "Team", label: "Project notebooks" },
      { value: "Other", label: "Other notebooks" },
    ]);
  });

  it.each(["Team", "Other"] as const)("doesn't offer Partner when the page holds %s", (current) => {
    expect(labMeetingNoteDefaultOptions(current).map((o) => o.value)).not.toContain("Partner");
  });

  it("shows a retired Partner option only while the page still holds it", () => {
    expect(labMeetingNoteDefaultOptions("Partner").at(-1)).toEqual({
      value: "Partner",
      label: "Partner meetings (retired)",
    });
  });
});

describe("templateToggleLabel", () => {
  it("calls a template in your own space private", () => {
    expect(templateToggleLabel(false, "Member")).toBe("Mark as private template");
  });

  it.each(["Lab", "Project", "EducationOffering"])("says plain 'Mark as template' in a %s space", (ws) => {
    expect(templateToggleLabel(false, ws)).toBe("Mark as template");
  });

  it.each(["Member", "Lab"])("offers unmarking a marked template in a %s space", (ws) => {
    expect(templateToggleLabel(true, ws)).toBe("Unmark as template");
  });
});
