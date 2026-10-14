import { describe, expect, it } from "vitest";
import { droppedFiles } from "../dropped-files";

const file = (name: string) => new File(["x"], name);
const item = (f: File | null, isDirectory?: boolean, kind = "file") => ({
  kind,
  getAsFile: () => f,
  webkitGetAsEntry: isDirectory === undefined ? undefined : () => ({ isDirectory }),
});
const dt = (parts: { items?: unknown[]; files?: File[] }) => parts as unknown as DataTransfer;

describe("droppedFiles", () => {
  it("returns every file when none is a directory", () => {
    const [a, b] = [file("a"), file("b")];
    expect(droppedFiles(dt({ items: [item(a, false), item(b, false)] }))).toEqual({ files: [a, b], skippedFolders: 0 });
  });

  it("drops directories and counts them", () => {
    const [a, dir, c] = [file("a"), file("dir"), file("c")];
    const result = droppedFiles(dt({ items: [item(a, false), item(dir, true), item(c, false)] }));
    expect(result.files).toEqual([a, c]);
    expect(result.skippedFolders).toBe(1);
  });

  it("ignores non-file items such as dragged text", () => {
    const a = file("a");
    expect(droppedFiles(dt({ items: [item(null, undefined, "string"), item(a, false)] })).files).toEqual([a]);
  });

  it("keeps files from browsers that cannot report entries", () => {
    const a = file("a");
    expect(droppedFiles(dt({ items: [item(a)] }))).toEqual({ files: [a], skippedFolders: 0 });
  });

  it("falls back to dataTransfer.files when items is empty", () => {
    const a = file("a");
    expect(droppedFiles(dt({ items: [], files: [a] }))).toEqual({ files: [a], skippedFolders: 0 });
  });

  it("is empty for an empty drop", () => {
    expect(droppedFiles(dt({}))).toEqual({ files: [], skippedFolders: 0 });
  });
});
