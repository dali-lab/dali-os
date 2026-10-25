import { Fragment, useMemo, useState, type ReactNode } from "react";
import {
  ChevronRight,
  FileCode,
  File,
  FileJson,
  FilePlus,
  FileText,
  Folder,
  FolderOpen,
  Pencil,
  Trash2,
} from "lucide-react";
import type { LabFiles } from "~/journeys/lib/types";
import { buildTree, ENTRY_FILE, normalizePath, validatePath, type TreeNode } from "~/journeys/lib/file-tree";
import { IconButton } from "~/components/ui/IconButton";
import { useDialog } from "~/components/ui/dialog";
import { cn } from "~/lib/cn";
import { PathInput } from "./PathInput";

function fileIcon(name: string) {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "json") return FileJson;
  if (ext === "md" || ext === "txt") return FileText;
  if (["html", "css", "js", "mjs", "jsx", "ts", "tsx", "svg"].includes(ext)) return FileCode;
  return File;
}

const ACTION = "h-6 w-6 p-0";

export function FileTree({
  files,
  activePath,
  onOpen,
  onCreate,
  onDelete,
  onRename,
}: {
  files: LabFiles;
  activePath: string | null;
  onOpen: (path: string) => void;
  onCreate: (path: string) => void;
  onDelete: (path: string) => void;
  onRename: (from: string, to: string) => void;
}) {
  const dialog = useDialog();
  const tree = useMemo(() => buildTree(Object.keys(files)), [files]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [creatingIn, setCreatingIn] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);

  const toggle = (path: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  const startCreate = (folder: string) => {
    setRenaming(null);
    setCreatingIn(folder);
    if (folder) setCollapsed((prev) => new Set([...prev].filter((p) => p !== folder)));
  };

  const confirmDelete = async (node: TreeNode) => {
    const ok = await dialog.confirm({
      title: `Delete ${node.name}?`,
      description: node.type === "folder" ? "Every file inside it is deleted too." : undefined,
      confirmLabel: "Delete",
      tone: "destructive",
    });
    if (ok) onDelete(node.path);
  };

  const join = (folder: string, v: string) => normalizePath(folder ? `${folder}/${v}` : v);

  const createInput = (folder: string, depth: number) =>
    creatingIn === folder ? (
      <PathInput
        key={`create-${folder}`}
        depth={depth}
        prefix={folder ? `${folder}/` : ""}
        placeholder="name.js or folder/name.js"
        validate={(v) => validatePath(files, join(folder, v))}
        onSubmit={(v) => {
          onCreate(join(folder, v));
          setCreatingIn(null);
        }}
        onCancel={() => setCreatingIn(null)}
      />
    ) : null;

  const renderNodes = (nodes: TreeNode[], depth: number): ReactNode =>
    nodes.map((node) => {
      const isFolder = node.type === "folder";
      const isOpen = isFolder && !collapsed.has(node.path);
      const isEntry = node.path === ENTRY_FILE;
      const parent = node.path.includes("/") ? node.path.slice(0, node.path.lastIndexOf("/")) : "";

      if (renaming === node.path) {
        return (
          <PathInput
            key={`rename-${node.path}`}
            depth={depth}
            prefix={parent ? `${parent}/` : ""}
            defaultValue={node.name}
            validate={(v) => validatePath(files, join(parent, v), node.path)}
            onSubmit={(v) => {
              const to = join(parent, v);
              if (to !== node.path) onRename(node.path, to);
              setRenaming(null);
            }}
            onCancel={() => setRenaming(null)}
          />
        );
      }

      const Icon = isFolder ? (isOpen ? FolderOpen : Folder) : fileIcon(node.name);
      return (
        <Fragment key={node.path}>
          <div
            role="treeitem"
            aria-expanded={isFolder ? isOpen : undefined}
            aria-selected={!isFolder && node.path === activePath}
            className={cn(
              "group flex h-8 items-center pr-1.5 transition-colors",
              !isFolder && node.path === activePath
                ? "bg-os-container/70 text-foreground"
                : "text-os-grey hover:bg-os-hover hover:text-foreground",
            )}
          >
            <button
              type="button"
              onClick={() => (isFolder ? toggle(node.path) : onOpen(node.path))}
              style={{ paddingLeft: depth * 12 + 8 }}
              className="flex h-full min-w-0 flex-1 items-center gap-1.5 text-left text-[13px]"
            >
              {isFolder ? (
                <ChevronRight className={cn("h-3.5 w-3.5 shrink-0 transition-transform", isOpen && "rotate-90")} aria-hidden />
              ) : (
                <span className="w-3.5 shrink-0" aria-hidden />
              )}
              <Icon className={cn("h-4 w-4 shrink-0", isFolder ? "text-os-amber/80" : "text-os-accent/80")} aria-hidden />
              <span className="truncate">{node.name}</span>
              {isEntry && <span className="ml-1 shrink-0 rounded bg-os-container px-1.5 text-[10px] text-os-muted">entry</span>}
            </button>
            {!isEntry && (
              <span className="flex shrink-0 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100 touch:opacity-100">
                {isFolder && (
                  <IconButton label={`New file in ${node.name}`} icon={FilePlus} className={ACTION} iconClassName="h-3.5 w-3.5" onClick={() => startCreate(node.path)} />
                )}
                <IconButton
                  label={`Rename ${node.name}`}
                  icon={Pencil}
                  className={ACTION}
                  iconClassName="h-3.5 w-3.5"
                  onClick={() => {
                    setCreatingIn(null);
                    setRenaming(node.path);
                  }}
                />
                <IconButton
                  label={`Delete ${node.name}`}
                  icon={Trash2}
                  tone="destructive"
                  className={ACTION}
                  iconClassName="h-3.5 w-3.5"
                  onClick={() => void confirmDelete(node)}
                />
              </span>
            )}
          </div>
          {isFolder && isOpen && (
            <div role="group">
              {createInput(node.path, depth + 1)}
              {renderNodes(node.children, depth + 1)}
            </div>
          )}
        </Fragment>
      );
    });

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-10 shrink-0 items-center justify-between pl-4 pr-2">
        <h3 className="text-xs font-medium text-os-grey">Files</h3>
        <IconButton label="New file" icon={FilePlus} onClick={() => startCreate("")} />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto pb-4" role="tree" aria-label="Lab files">
        {createInput("", 0)}
        {renderNodes(tree, 0)}
      </div>
    </div>
  );
}
