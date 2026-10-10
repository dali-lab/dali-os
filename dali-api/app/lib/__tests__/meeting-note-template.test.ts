import { describe, it, expect } from "vitest";
import {
  hashTemplateText,
  normalizeTemplateText,
  isUntouchedTemplate,
} from "../meeting-note-template";

describe("normalizeTemplateText", () => {
  it("collapses runs of whitespace and trims the ends", () => {
    expect(normalizeTemplateText("  Agenda\n\nNotes\t\tDecisions  ")).toBe("Agenda Notes Decisions");
  });
});

describe("hashTemplateText", () => {
  it("is deterministic for the same input", () => {
    expect(hashTemplateText("Agenda Notes")).toBe(hashTemplateText("Agenda Notes"));
  });

  it("differs for different input", () => {
    expect(hashTemplateText("Agenda Notes")).not.toBe(hashTemplateText("Agenda Notes Decisions"));
  });

  it("hashes the empty string without throwing", () => {
    expect(() => hashTemplateText("")).not.toThrow();
  });
});

describe("isUntouchedTemplate", () => {
  const hash = hashTemplateText(normalizeTemplateText("## Agenda\n\n## Notes"));

  it("is false when the page was never seeded", () => {
    expect(
      isUntouchedTemplate({ seededFromPageId: null, seededTemplateHash: null }, "## Agenda\n\n## Notes"),
    ).toBe(false);
  });

  it("is true when the current text hashes the same as the seeded hash", () => {
    expect(
      isUntouchedTemplate(
        { seededFromPageId: "tpl-1", seededTemplateHash: hash },
        "## Agenda\n\n## Notes",
      ),
    ).toBe(true);
  });

  it("tolerates whitespace-only differences (normalized before hashing)", () => {
    expect(
      isUntouchedTemplate(
        { seededFromPageId: "tpl-1", seededTemplateHash: hash },
        "## Agenda\n\n\n## Notes   ",
      ),
    ).toBe(true);
  });

  it("is false once the text has actually changed", () => {
    expect(
      isUntouchedTemplate(
        { seededFromPageId: "tpl-1", seededTemplateHash: hash },
        "## Agenda\n\nWe decided to ship it.\n\n## Notes",
      ),
    ).toBe(false);
  });
});
