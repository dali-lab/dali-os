import { describe, it, expect } from "vitest";
// Pure renderers only (no DB import).
import { renderNodes, type PMNode } from "../export-html";
import { renderProseMirrorToPdf } from "../export-pdf";

describe("export-html — signing fields + variables", () => {
  it("renders a resolved variable's baked value", () => {
    const nodes: PMNode[] = [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "Term: " },
          { type: "variable", attrs: { name: "term", value: "26S" } },
        ],
      },
    ];
    expect(renderNodes(nodes)).toBe("<p>Term: <span>26S</span></p>");
  });

  it("renders an unresolved variable as its token", () => {
    const nodes: PMNode[] = [{ type: "variable", attrs: { name: "term" } }];
    expect(renderNodes(nodes)).toBe("<span>{{term}}</span>");
  });

  it("renders a filled signature over a line and a blank line when empty", () => {
    const filled = renderNodes([
      { type: "signatureField", attrs: { fieldId: "s", role: "member", value: "Ada Lovelace" } },
    ]);
    expect(filled).toContain("Ada Lovelace");
    expect(filled).toContain("border-bottom");

    const blank = renderNodes([
      { type: "signatureField", attrs: { fieldId: "s", role: "member" } },
    ]);
    expect(blank).toContain("border-bottom");
    expect(blank).not.toContain("Ada");
  });

  it("renders checkbox glyphs", () => {
    expect(
      renderNodes([{ type: "checkboxField", attrs: { fieldId: "c", role: "member", value: true } }]),
    ).toBe("<span>☑</span>");
    expect(
      renderNodes([{ type: "checkboxField", attrs: { fieldId: "c", role: "member", value: false } }]),
    ).toBe("<span>☐</span>");
  });
});

describe("export-pdf — signing fields render without throwing", () => {
  it("produces a PDF buffer for a doc with fields + variables", async () => {
    const doc: PMNode = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Welcome for " },
            { type: "variable", attrs: { name: "term", value: "26S" } },
          ],
        },
        {
          type: "paragraph",
          content: [
            { type: "signatureField", attrs: { fieldId: "s", role: "member", value: "Ada" } },
            { type: "checkboxField", attrs: { fieldId: "c", role: "member", value: true } },
          ],
        },
      ],
    };
    const buf = await renderProseMirrorToPdf("Term Agreement", doc);
    expect(buf.length).toBeGreaterThan(0);
  });
});
