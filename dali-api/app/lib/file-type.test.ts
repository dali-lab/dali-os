import { describe, expect, it } from "vitest";
import {
  categorize,
  canPreviewInline,
  getExtension,
  resolveContentType,
  type FileCategory,
} from "./file-type";

describe("getExtension", () => {
  it("returns the lowercased extension with a leading dot", () => {
    expect(getExtension("Report.PDF")).toBe(".pdf");
    expect(getExtension("archive.tar.gz")).toBe(".gz");
  });
  it("returns empty string when there is no extension", () => {
    expect(getExtension("Makefile")).toBe("");
  });
});

describe("resolveContentType", () => {
  it("prefers a real provided content type", () => {
    expect(resolveContentType("x.bin", "image/png")).toBe("image/png");
  });
  it("falls back to the extension when content type is missing", () => {
    expect(resolveContentType("photo.png")).toBe("image/png");
  });
  it("falls back to the extension when content type is octet-stream", () => {
    // uploads default to octet-stream when the browser reports no File.type
    expect(resolveContentType("doc.pdf", "application/octet-stream")).toBe("application/pdf");
  });
  it("keeps octet-stream when the extension is unknown", () => {
    expect(resolveContentType("blob.xyz", "application/octet-stream")).toBe(
      "application/octet-stream",
    );
  });
});

describe("categorize", () => {
  const cases: Array<[string, string | null | undefined, FileCategory]> = [
    // MIME-driven
    ["a.bin", "image/jpeg", "image"],
    ["a.bin", "video/mp4", "video"],
    ["a.bin", "audio/mpeg", "audio"],
    ["a.bin", "application/pdf", "pdf"],
    ["a.bin", "text/csv", "text"],
    ["a.bin", "application/json", "text"],
    ["a.bin", "model/gltf-binary", "model3d"],
    ["a.bin", "application/zip", "archive"],
    [
      "a.bin",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "office",
    ],
    ["a.bin", "application/x-figma", "other"],
    // extension-driven (no content type)
    ["photo.PNG", null, "image"],
    ["clip.mov", null, "video"],
    ["notes.md", null, "text"],
    ["deck.pptx", null, "office"],
    ["model.stl", null, "model3d"],
    ["bundle.7z", null, "archive"],
    ["mystery.xyz", null, "other"],
    // octet-stream recovers via extension
    ["doc.pdf", "application/octet-stream", "pdf"],
    // real MIME wins over a misleading extension
    ["invoice.pdf", "image/png", "image"],
  ];
  it.each(cases)("categorize(%s, %s) → %s", (fileName, contentType, expected) => {
    expect(categorize({ fileName, contentType })).toBe(expected);
  });
});

describe("canPreviewInline", () => {
  it("is true for the categories with a real inline viewer", () => {
    for (const c of ["image", "video", "audio", "pdf", "text"] as FileCategory[]) {
      expect(canPreviewInline(c)).toBe(true);
    }
  });
  it("is false for categories that fall back to download", () => {
    for (const c of ["office", "archive", "model3d", "other"] as FileCategory[]) {
      expect(canPreviewInline(c)).toBe(false);
    }
  });
});
