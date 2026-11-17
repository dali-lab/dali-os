import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FormField } from "~/components/ui/FormField";

describe("FormField input attributes", () => {
  it("passes maxLength, disabled and inputMode to a single-line input", () => {
    const html = renderToStaticMarkup(
      createElement(FormField, { label: "Link", value: "", onChange: () => {}, maxLength: 120, disabled: true, inputMode: "url" }),
    );
    expect(html).toContain('maxLength="120"');
    expect(html).toContain("disabled");
    expect(html).toContain('inputMode="url"');
  });

  it("passes maxLength to a multiline field", () => {
    const html = renderToStaticMarkup(
      createElement(FormField, { label: "Note", multiline: true, value: "", onChange: () => {}, maxLength: 400 }),
    );
    expect(html).toContain("<textarea");
    expect(html).toContain('maxLength="400"');
  });

  it("hides the label visually but keeps it in the markup", () => {
    const html = renderToStaticMarkup(createElement(FormField, { label: "Title", labelHidden: true, value: "", onChange: () => {} }));
    expect(html).toContain('<span class="sr-only">Title</span>');
  });
});
