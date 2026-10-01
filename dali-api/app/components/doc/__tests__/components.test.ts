import { describe, it, expect } from "vitest";
import {
  COMPONENT_KINDS,
  codeHeight,
  codeSrcDoc,
  parseComponentData,
  safeHref,
} from "../components/kinds";
import { resolveFeatures } from "../features";

describe("component library", () => {
  it("is on for resource surfaces only, so plain documents can't author one", () => {
    expect(resolveFeatures("resource").components).toBe(true);
    expect(resolveFeatures("document").components).toBeUndefined();
  });

  it("reads bad or empty data as the kind's defaults", () => {
    for (const def of COMPONENT_KINDS) {
      expect(parseComponentData(def.kind, "")).toEqual(def.defaults);
      expect(parseComponentData(def.kind, "{not json")).toEqual(def.defaults);
    }
  });

  it("keeps only string values from stored data", () => {
    const json = JSON.stringify({ fields: { title: "T", n: 3 }, items: [{ label: "A", x: null }, "junk"] });
    expect(parseComponentData("cards", json)).toEqual({
      fields: { title: "T" },
      items: [{ label: "A" }, {}],
    });
  });

  it("only links to web, mail and in-app targets", () => {
    expect(safeHref("https://dali.dartmouth.edu")).toBe("https://dali.dartmouth.edu");
    expect(safeHref("/resources")).toBe("/resources");
    expect(safeHref("mailto:a@b.co")).toBe("mailto:a@b.co");
    expect(safeHref("javascript:alert(1)")).toBeUndefined();
    expect(safeHref("data:text/html,x")).toBeUndefined();
    expect(safeHref("//evil.example")).toBeUndefined();
    expect(safeHref("")).toBeUndefined();
  });

  it("wraps custom code in a policy with no network access", () => {
    const doc = codeSrcDoc("<p>hi</p>");
    expect(doc).toContain("default-src 'none'");
    expect(doc).not.toContain("connect-src");
    expect(doc.endsWith("<p>hi</p>")).toBe(true);
  });

  it("clamps custom code height", () => {
    expect(codeHeight("600")).toBe("600px");
    expect(codeHeight("5")).toBe("320px");
    expect(codeHeight("99999")).toBe("4000px");
    expect(codeHeight("full")).toContain("100dvh");
  });
});
