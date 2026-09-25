import { describe, it, expect } from "vitest";
import {
  fileMatchesAccept,
  MAX_FILE_STORE_BYTES,
  MAX_UPLOAD_BYTES,
  uploadCapForKey,
} from "~/lib/file-validation";

describe("fileMatchesAccept", () => {
  it("accepts any file when accept is empty or undefined", () => {
    expect(fileMatchesAccept("foo.exe", "application/octet-stream", undefined)).toBe(true);
    expect(fileMatchesAccept("foo.exe", "application/octet-stream", "")).toBe(true);
    expect(fileMatchesAccept("foo.exe", "application/octet-stream", "   ")).toBe(true);
  });

  it("matches an exact MIME type", () => {
    expect(fileMatchesAccept("a.pdf", "application/pdf", "application/pdf")).toBe(true);
    expect(fileMatchesAccept("a.png", "image/png", "application/pdf")).toBe(false);
  });

  it("matches a comma-separated MIME list", () => {
    const accept = "image/png, image/jpeg, application/pdf";
    expect(fileMatchesAccept("a.png", "image/png", accept)).toBe(true);
    expect(fileMatchesAccept("a.jpg", "image/jpeg", accept)).toBe(true);
    expect(fileMatchesAccept("a.pdf", "application/pdf", accept)).toBe(true);
    expect(fileMatchesAccept("a.gif", "image/gif", accept)).toBe(false);
  });

  it("matches MIME wildcards like image/*", () => {
    expect(fileMatchesAccept("a.png", "image/png", "image/*")).toBe(true);
    expect(fileMatchesAccept("a.webp", "image/webp", "image/*")).toBe(true);
    expect(fileMatchesAccept("a.pdf", "application/pdf", "image/*")).toBe(false);
  });

  it("matches by extension when MIME type is missing", () => {
    expect(fileMatchesAccept("resume.pdf", "", ".pdf")).toBe(true);
    expect(fileMatchesAccept("resume.PDF", "", ".pdf")).toBe(true);
    expect(fileMatchesAccept("resume.pdf", "", ".png,.jpg")).toBe(false);
  });

  it("matches when extension is in the accept list alongside MIME entries", () => {
    const accept = "image/png,.pdf";
    expect(fileMatchesAccept("doc.pdf", "", accept)).toBe(true);
    expect(fileMatchesAccept("img.png", "image/png", accept)).toBe(true);
    expect(fileMatchesAccept("img.gif", "image/gif", accept)).toBe(false);
  });

  it("rejects mismatched extension when MIME is empty and only ext entries match", () => {
    expect(fileMatchesAccept("script.exe", "", ".pdf,.png")).toBe(false);
  });

  it("rejects a file with no extension and unmatched MIME", () => {
    expect(fileMatchesAccept("README", "text/plain", "image/*")).toBe(false);
  });
});

describe("MAX_UPLOAD_BYTES", () => {
  it("is 10 MB", () => {
    expect(MAX_UPLOAD_BYTES).toBe(10 * 1024 * 1024);
  });
});

describe("uploadCapForKey", () => {
  it.each([
    "project-files/proj1/uuid-deck.pdf",
    "uploads/project-files/proj1/uuid-deck.pdf",
    "lab-files/uuid-recording.mp4",
    "drive-files/uuid-dataset.zip",
    "uploads/drive-files/uuid-dataset.zip",
  ])("gives the file store 100 MB: %s", (key) => {
    const cap = uploadCapForKey(key);
    expect(cap.maxBytes).toBe(MAX_FILE_STORE_BYTES);
    expect(cap.maxBytes).toBe(100 * 1024 * 1024);
    expect(cap.label).toBe("100 MB");
    expect(cap.expiresIn).toBe(900);
  });

  it.each([
    "avatars/uuid-me.png",
    "uploads/doc-images/uuid-header.jpg",
    "page-docs/uuid-demo.mp4",
    "whiteboard-images/uuid.png",
    // A look-alike segment deeper in the key doesn't count.
    "avatars/project-files/uuid.png",
  ])("keeps everything else at 10 MB: %s", (key) => {
    const cap = uploadCapForKey(key);
    expect(cap.maxBytes).toBe(MAX_UPLOAD_BYTES);
    expect(cap.label).toBe("10 MB");
    expect(cap.expiresIn).toBe(300);
  });
});
