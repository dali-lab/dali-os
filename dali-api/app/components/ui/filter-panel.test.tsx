import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  FilterPill,
  customizeButtonClass,
  filterPanelClass,
  filterPillStateClass,
} from "~/components/ui/filter-panel";

function pill(props: { selected: boolean; size?: "sm" | "md"; variant?: "default" | "filled" }) {
  return renderToStaticMarkup(
    createElement(FilterPill, { onClick: () => {}, ...props, children: "Label" }),
  );
}

describe("FilterPill", () => {
  it("draws the default selected pill as an accent tint", () => {
    const html = pill({ selected: true });
    expect(html).toContain("border-os-accent bg-os-accent/15 text-os-accent");
    expect(html).toContain('aria-pressed="true"');
  });

  it("draws the default unselected pill without a card fill, even at md", () => {
    const html = pill({ selected: false, size: "md" });
    expect(html).toContain("border-os-container text-os-grey");
    expect(html).not.toContain("bg-card");
  });

  it("fills the selected pill solid in the filled variant", () => {
    expect(pill({ selected: true, variant: "filled", size: "md" })).toContain(
      "border-os-accent bg-os-accent font-medium text-background",
    );
  });

  it("rests the filled variant on the card at md and not at sm", () => {
    expect(pill({ selected: false, variant: "filled", size: "md" })).toContain(
      "border-border text-muted-foreground hover:bg-muted/40 hover:text-foreground bg-card",
    );
    expect(filterPillStateClass(false, "sm", "filled")).not.toContain("bg-card");
  });
});

describe("filter panel classes", () => {
  it("marks the customize button active with the accent border", () => {
    expect(customizeButtonClass(true)).toContain("border-os-accent text-os-accent");
    expect(customizeButtonClass(false)).not.toContain("border-os-accent");
  });

  it("layers the panel above floating content", () => {
    expect(filterPanelClass()).toContain("z-[60]");
  });
});
