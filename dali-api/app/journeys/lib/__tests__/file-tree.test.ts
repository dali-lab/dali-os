import { describe, expect, it } from "vitest";
import {
  addFile,
  buildTree,
  defaultFilePath,
  ENTRY_FILE,
  normalizePath,
  removePath,
  renamePath,
  renamePathIn,
  validatePath,
} from "../file-tree";

describe("buildTree", () => {
  it("nests paths into folders, folders first then files, each alphabetical", () => {
    const tree = buildTree(["z.js", "src/b.js", "index.html", "src/a/x.js", "a.css", "lib/y.js"]);
    expect(tree.map((n) => `${n.type}:${n.name}`)).toEqual(["folder:lib", "folder:src", "file:a.css", "file:index.html", "file:z.js"]);
    const src = tree[1];
    expect(src.path).toBe("src");
    expect(src.children.map((n) => n.path)).toEqual(["src/a", "src/b.js"]);
    expect(src.children[0].children).toEqual([{ name: "x.js", path: "src/a/x.js", type: "file", children: [] }]);
  });
  it("returns nothing for no files", () => {
    expect(buildTree([])).toEqual([]);
  });
});

describe("normalizePath", () => {
  it("trims, converts backslashes, strips leading ./ and / and collapses slashes", () => {
    expect(normalizePath("  ./src\\\\a//b.js ")).toBe("src/a/b.js");
    expect(normalizePath("/./x.js")).toBe("x.js");
    expect(normalizePath("a.js")).toBe("a.js");
  });
});

describe("validatePath", () => {
  const files = { "index.html": "", "src/main.js": "", "notes.md": "" };
  it("explains each problem", () => {
    expect(validatePath(files, "")).toBe("Enter a file name.");
    expect(validatePath(files, "src/")).toBe("Add a file name after the folder.");
    expect(validatePath(files, "../x.js")).toBe("Use a path inside the lab.");
    expect(validatePath(files, "a/./x.js")).toBe("Use a path inside the lab.");
    expect(validatePath(files, "index.html")).toBe("Something with that name already exists.");
    expect(validatePath(files, "src")).toBe("Something with that name already exists.");
    expect(validatePath(files, "notes.md/x.js")).toBe("A file is using part of that path.");
  });
  it("accepts new paths and the path being renamed", () => {
    expect(validatePath(files, "src/new.js")).toBeNull();
    expect(validatePath(files, "src/main.js", "src/main.js")).toBeNull();
  });
});

describe("file edits", () => {
  const files = { "index.html": "<p>", "src/a.js": "a", "src/b/c.js": "c", "srcx.js": "x" };
  it("adds an empty file only when missing", () => {
    expect(addFile(files, "new.js")).toEqual({ ...files, "new.js": "" });
    expect(addFile(files, "src/a.js")).toBe(files);
  });
  it("removes a file or a whole folder, not paths that share a prefix", () => {
    expect(removePath(files, "src/a.js")).toEqual({ "index.html": "<p>", "src/b/c.js": "c", "srcx.js": "x" });
    expect(removePath(files, "src")).toEqual({ "index.html": "<p>", "srcx.js": "x" });
  });
  it("renames a file or a folder's contents and keeps contents", () => {
    expect(renamePathIn("src/a.js", "src", "lib")).toBe("lib/a.js");
    expect(renamePathIn("srcx.js", "src", "lib")).toBe("srcx.js");
    expect(renamePathIn("src", "src", "lib")).toBe("lib");
    expect(renamePath(files, "src", "lib")).toEqual({ "index.html": "<p>", "lib/a.js": "a", "lib/b/c.js": "c", "srcx.js": "x" });
  });
});

describe("defaultFilePath", () => {
  it("prefers the requested file, then the entry, then the first path alphabetically", () => {
    expect(defaultFilePath({ [ENTRY_FILE]: "", "b.js": "" }, "b.js")).toBe("b.js");
    expect(defaultFilePath({ [ENTRY_FILE]: "", "b.js": "" }, "gone.js")).toBe(ENTRY_FILE);
    expect(defaultFilePath({ "z.js": "", "a.js": "" })).toBe("a.js");
    expect(defaultFilePath({})).toBeNull();
  });
});
