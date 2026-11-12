import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DriveTagFilter, type FilterTag } from "~/components/drive/DriveTagFilter";

const tags: FilterTag[] = [
  { id: "a", label: "Onboarding", color: null },
  { id: "b", label: "Finance", color: "#ff8866" },
  { id: "c", label: "Design", color: "accent-teal" },
];

function render(selectedIds: Set<string>) {
  return renderToStaticMarkup(
    createElement(DriveTagFilter, {
      tags,
      selectedIds,
      onToggle: () => {},
      onClear: () => {},
    }),
  );
}

describe("DriveTagFilter trigger", () => {
  it("labels the pill 'Tags' without the active outline when nothing is selected", () => {
    const html = render(new Set());
    expect(html).toContain("Tags");
    expect(html).not.toContain("border-os-accent");
  });

  it("shows a singular count for one selected tag", () => {
    const html = render(new Set(["a"]));
    expect(html).toContain("1 tag");
    expect(html).toContain("border-os-accent");
  });

  it("shows a plural count for multiple selected tags", () => {
    const html = render(new Set(["a", "b"]));
    expect(html).toContain("2 tags");
  });

  it("does not draw its own chips, since the hub shows them under the toolbar", () => {
    const html = render(new Set(["a", "b"]));
    expect(html).not.toContain('aria-label="Remove');
  });
});
