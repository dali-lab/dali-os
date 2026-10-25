import type { LabFiles } from "./types";

export const ENTRY_FILE = "index.html";

export interface TreeNode {
  name: string;
  path: string;
  type: "file" | "folder";
  children: TreeNode[];
}

/** Folders first, then files, each alphabetical. */
export function buildTree(paths: string[]): TreeNode[] {
  const root: TreeNode = { name: "", path: "", type: "folder", children: [] };
  for (const fullPath of paths) {
    const parts = fullPath.split("/");
    let node = root;
    parts.forEach((part, i) => {
      const path = parts.slice(0, i + 1).join("/");
      const isFile = i === parts.length - 1;
      let child = node.children.find((c) => c.name === part && c.type === (isFile ? "file" : "folder"));
      if (!child) {
        child = { name: part, path, type: isFile ? "file" : "folder", children: [] };
        node.children.push(child);
      }
      node = child;
    });
  }
  const sort = (nodes: TreeNode[]): TreeNode[] =>
    nodes
      .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "folder" ? -1 : 1))
      .map((n) => ({ ...n, children: sort(n.children) }));
  return sort(root.children);
}

export function normalizePath(input: string): string {
  return input
    .trim()
    .replace(/\\/g, "/")
    .replace(/^(\.\/|\/)+/, "")
    .replace(/\/{2,}/g, "/");
}

/** A message explaining why `path` can't be used, or null when it can. */
export function validatePath(files: LabFiles, path: string, ignore?: string): string | null {
  if (!path) return "Enter a file name.";
  if (path.endsWith("/")) return "Add a file name after the folder.";
  if (path.split("/").some((seg) => seg === ".." || seg === ".")) return "Use a path inside the lab.";
  if (path !== ignore && (path in files || Object.keys(files).some((p) => p.startsWith(`${path}/`)))) {
    return "Something with that name already exists.";
  }
  if (Object.keys(files).some((p) => p !== ignore && path.startsWith(`${p}/`))) return "A file is using part of that path.";
  return null;
}

export function addFile(files: LabFiles, path: string): LabFiles {
  return path in files ? files : { ...files, [path]: "" };
}

export function removePath(files: LabFiles, path: string): LabFiles {
  return Object.fromEntries(Object.entries(files).filter(([p]) => p !== path && !p.startsWith(`${path}/`)));
}

export function renamePathIn(path: string, from: string, to: string): string {
  if (path === from) return to;
  if (path.startsWith(`${from}/`)) return to + path.slice(from.length);
  return path;
}

export function renamePath(files: LabFiles, from: string, to: string): LabFiles {
  return Object.fromEntries(Object.entries(files).map(([p, v]) => [renamePathIn(p, from, to), v]));
}

export function defaultFilePath(files: LabFiles, preferred?: string): string | null {
  if (preferred && preferred in files) return preferred;
  if (ENTRY_FILE in files) return ENTRY_FILE;
  return Object.keys(files).sort()[0] ?? null;
}
