import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ComponentView } from "../components/views";

describe("links component", () => {
  it("shows each row's detail text", () => {
    const html = renderToStaticMarkup(
      <ComponentView
        kind="links"
        data={{ fields: {}, items: [{ title: "Crit schedule", meta: "Next: Tue 7pm", href: "" }] }}
      />,
    );
    expect(html).toContain('<span class="dali-cmp-meta">Next: Tue 7pm</span>');
  });

  it("leaves the detail out when a row has none", () => {
    const html = renderToStaticMarkup(
      <ComponentView kind="links" data={{ fields: {}, items: [{ title: "How it works", meta: "", href: "" }] }} />,
    );
    expect(html).not.toContain("dali-cmp-meta");
  });
});

describe("feature component call to action", () => {
  const render = (fields: Record<string, string>) =>
    renderToStaticMarkup(<ComponentView kind="feature" data={{ fields: { title: "T", ...fields }, items: [] }} />);

  it("links the button when the link is safe", () => {
    expect(render({ cta: "Go", href: "https://dali.dartmouth.edu" })).toContain('<a class="dali-cmp-cta" href="https://dali.dartmouth.edu"');
  });

  it("shows no button when the link is empty or unsafe", () => {
    for (const href of ["", "javascript:alert(1)"]) expect(render({ cta: "Go", href })).not.toContain("dali-cmp-cta");
  });
});

describe("link targets", () => {
  const chip = (href: string) =>
    renderToStaticMarkup(<ComponentView kind="chips" data={{ fields: {}, items: [{ label: "X", href }] }} />);

  it("opens web and mail links in a new tab", () => {
    expect(chip("https://example.com")).toContain('target="_blank"');
    expect(chip("mailto:a@example.edu")).toContain('target="_blank"');
  });

  it("keeps in-app paths, anchors and tel links in the same tab", () => {
    for (const href of ["/resources", "#top", "tel:+16035550100"]) expect(chip(href)).not.toContain("target=");
  });
});
