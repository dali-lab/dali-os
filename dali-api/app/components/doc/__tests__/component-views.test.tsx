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
