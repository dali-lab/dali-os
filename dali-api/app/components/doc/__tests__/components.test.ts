import { describe, it, expect } from "vitest";
import {
  COMPONENT_KINDS,
  codeHeight,
  codeSrcDoc,
  blankComponentData,
  collectionCategories,
  filterCollection,
  parseComponentData,
  safeHref,
  spacerHeight,
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

  it("links to any scheme except script-capable ones", () => {
    expect(safeHref("https://dali.dartmouth.edu")).toBe("https://dali.dartmouth.edu");
    expect(safeHref("/resources")).toBe("/resources");
    expect(safeHref("mailto:a@b.co")).toBe("mailto:a@b.co");
    expect(safeHref("tel:+16035550100")).toBe("tel:+16035550100");
    expect(safeHref("slack://channel?team=T1&id=C1")).toBe("slack://channel?team=T1&id=C1");
    expect(safeHref("#section")).toBe("#section");
    expect(safeHref("dali.dev/docs")).toBe("https://dali.dev/docs");
    expect(safeHref("JavaScript:alert(1)")).toBeUndefined();
    expect(safeHref("data:text/html,x")).toBeUndefined();
    for (const bad of ["ms-msdt:/id PCWDiagnostic", "intent://scan#Intent;end", "vbscript:x", "file:///etc/passwd", "myapp://open"]) {
      expect(safeHref(bad), bad).toBeUndefined();
    }
    expect(safeHref("//evil.example")).toBeUndefined();
    expect(safeHref("")).toBeUndefined();
  });

  it("starts a new component empty but keeps its settings", () => {
    const chips = COMPONENT_KINDS.find((d) => d.kind === "chips")!;
    expect(blankComponentData(chips)).toEqual({ fields: { label: "", layout: "stacked" }, items: [] });
    const feature = COMPONENT_KINDS.find((d) => d.kind === "feature")!;
    const blank = blankComponentData(feature);
    expect(blank.fields.tone).toBe("warning");
    expect(blank.fields.title).toBe("");
    expect(blank.items).toEqual([]);
    for (const def of COMPONENT_KINDS) expect(blankComponentData(def).items).toEqual([]);
  });

  it("offers listed categories first, then any an item uses", () => {
    expect(collectionCategories({ categories: "Design, Development , design" }, [{ category: "Resources" }, { category: "development" }, {}])).toEqual(["Design", "Development", "Resources"]);
    expect(collectionCategories({}, [])).toEqual([]);
  });

  it("filters a collection by category, ignoring case", () => {
    const items: Record<string, string>[] = [{ title: "a", category: "Design" }, { title: "b", category: "design " }, { title: "c", category: "Dev" }, { title: "d" }];
    expect(filterCollection(items, null)).toHaveLength(4);
    expect(filterCollection(items, "Design").map((i) => i.title)).toEqual(["a", "b"]);
    expect(filterCollection(items, "Missing")).toEqual([]);
  });

  it("wraps custom code in a policy with no network access", () => {
    const doc = codeSrcDoc("<p>hi</p>");
    expect(doc).toContain("default-src 'none'");
    expect(doc).not.toContain("connect-src");
    expect(doc.endsWith("<p>hi</p>")).toBe(true);
  });

  it("clamps spacer height", () => {
    expect(spacerHeight("48")).toBe("48px");
    expect(spacerHeight("")).toBe("32px");
    expect(spacerHeight("9999")).toBe("400px");
  });

  it("clamps custom code height", () => {
    expect(codeHeight("600")).toBe("600px");
    expect(codeHeight("5")).toBe("320px");
    expect(codeHeight("99999")).toBe("4000px");
    expect(codeHeight("full")).toContain("100dvh");
  });
});
