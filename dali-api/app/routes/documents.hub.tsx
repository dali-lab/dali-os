import { useEffect, useMemo, useState } from "react";
import {
  redirect,
  useLoaderData,
  useRevalidator,
  useSearchParams,
} from "react-router";
import type { Route } from "./+types/documents.hub";
import {
  Archive,
  ChevronDown,
  ChevronRight,
  FileText,
  Folder,
  FolderPlus,
  Pin,
  Plus,
  Search,
  Tag as TagIcon,
  X,
} from "lucide-react";
import { prisma } from "~/lib/db";
import { requireAuth, redirectPartnerToPortal } from "~/lib/auth";
import { isCore, isLabMember, currentTerm } from "~/lib/roles";
import { Tooltip } from "~/components/ui/IconButton";
import { useDialog } from "~/components/ui/dialog";
import { PageIcon } from "~/components/PageIcon";
import { ProjectIcon } from "~/components/ProjectIcon";
import type { ProjectStatus } from "~/generated/prisma/client";

export const meta: Route.MetaFunction = () => [{ title: "Documents · DALI OS" }];

// The lab-wide Documents hub. Aggregates the Lab-workspace document tree (the
// dedicated home for lab-wide docs) plus the viewer's project documents, so
// everything is filterable/searchable in one place. Lab docs are fully managed
// here (create/archive/pin — any lab member); project docs are read + pin only
// (their create/archive stays in the project hub). Tags are applied in each
// document's editor; here they only drive the filter bar.
//
// Project list defaults to Active + current-term (same as the projects hub
// term view). `?projects=all` includes Paused/Archived and non-current-term
// projects so older workspaces stay reachable. Archived *pages* (archivedAt)
// stay hidden either way.

type DocTagOut = { id: string; label: string; slug: string; color: string | null };

type DocOut = {
  id: string;
  title: string;
  kind: "FreeForm" | "Structured" | "Folder";
  parentPageId: string | null;
  isSystem: boolean;
  pinned: boolean;
  pinnedAt: number | null;
  iconEmoji: string | null;
  tags: DocTagOut[];
  workspaceKey: string;
  workspaceLabel: string;
  workspaceKind: "lab" | "project";
};

type WorkspaceOut = {
  key: string;
  label: string;
  kind: "lab" | "project";
  canManage: boolean;
  // Present for project workspaces — drives the Archived badge in All view.
  projectStatus?: ProjectStatus;
  // Project's custom emoji, shown before its name in the group header.
  projectIconEmoji?: string | null;
};

type ProjectFilter = "active" | "all";

function parseProjectFilter(raw: string | null): ProjectFilter {
  return raw === "all" ? "all" : "active";
}

const pageSelect = {
  id: true,
  title: true,
  kind: true,
  parentPageId: true,
  systemKey: true,
  pinnedAt: true,
  iconEmoji: true,
  tags: {
    select: { tag: { select: { id: true, label: true, slug: true, color: true } } },
  },
} as const;

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");
  if (auth.user.type === "applicant") return redirect("/portal");
  const partnerRedirect = await redirectPartnerToPortal(auth);
  if (partnerRedirect) return partnerRedirect;

  const url = new URL(request.url);
  const projectFilter = parseProjectFilter(url.searchParams.get("projects"));

  const [member, core, term] = await Promise.all([
    isLabMember(auth.user.sub),
    isCore(auth.user.sub),
    currentTerm(),
  ]);

  // Lab-wide pages + projects whose docs the viewer may see (Core sees all;
  // everyone else sees projects they're staffed on). Active (default) matches
  // the projects hub term view — current-term Active only. All drops the
  // status/term gates so archived + older-term projects stay reachable.
  const [labPages, projects] = await Promise.all([
    prisma.page.findMany({
      where: { workspaceType: "Lab", workspaceId: null, archivedAt: null },
      orderBy: { position: "asc" },
      select: pageSelect,
    }),
    prisma.project.findMany({
      where: {
        ...(projectFilter === "active"
          ? {
              status: "Active" as const,
              ...(term ? { projectTerms: { some: { termId: term.id } } } : {}),
            }
          : {}),
        ...(core ? {} : { assignments: { some: { userId: auth.user.sub } } }),
      },
      orderBy: [{ status: "asc" }, { name: "asc" }],
      select: { id: true, name: true, status: true, iconEmoji: true },
    }),
  ]);

  const projectIds = projects.map((p) => p.id);
  const projectPages = projectIds.length
    ? await prisma.page.findMany({
        where: { workspaceType: "Project", workspaceId: { in: projectIds }, archivedAt: null },
        orderBy: { position: "asc" },
        select: { ...pageSelect, workspaceId: true },
      })
    : [];

  const allTags = await prisma.docTag.findMany({
    where: { archivedAt: null },
    orderBy: { label: "asc" },
    select: { id: true, label: true, slug: true, color: true },
  });

  const projectById = new Map(projects.map((p) => [p.id, p]));
  const toDto = (
    p: (typeof labPages)[number] & { workspaceId?: string | null },
    workspaceKey: string,
    workspaceLabel: string,
    workspaceKind: "lab" | "project",
  ): DocOut => ({
    id: p.id,
    title: p.title,
    kind: p.kind as DocOut["kind"],
    parentPageId: p.parentPageId,
    isSystem: p.systemKey !== null,
    pinned: p.pinnedAt !== null,
    pinnedAt: p.pinnedAt?.getTime() ?? null,
    iconEmoji: p.iconEmoji,
    tags: p.tags
      .map((t) => t.tag)
      .sort((a, b) => a.label.localeCompare(b.label)),
    workspaceKey,
    workspaceLabel,
    workspaceKind,
  });

  const docs: DocOut[] = [
    ...labPages.map((p) => toDto(p, "lab", "Lab-wide", "lab")),
    ...projectPages.map((p) =>
      toDto(p, p.workspaceId!, projectById.get(p.workspaceId!)?.name ?? "Project", "project"),
    ),
  ];

  const workspaces: WorkspaceOut[] = [
    { key: "lab", label: "Lab-wide", kind: "lab", canManage: member },
    ...projects.map(
      (p): WorkspaceOut => ({
        key: p.id,
        label: p.name,
        kind: "project",
        canManage: true,
        projectStatus: p.status,
        projectIconEmoji: p.iconEmoji,
      }),
    ),
  ];

  return { docs, workspaces, allTags, projectFilter };
}

// Open a document as a split-screen tab beside the hub. This page renders
// inside the TabWorkspace iframe, so ask the parent shell to open
// /documents/:id in a second pane (dali:openTabToSide → Layout). Falls back to
// a same-tab navigation when rendered standalone.
function openDocumentTab(pageId: string, label: string) {
  const url = `/documents/${pageId}`;
  if (typeof window !== "undefined" && window.self !== window.top) {
    window.parent.postMessage({ type: "dali:openTabToSide", url, label }, window.location.origin);
  } else if (typeof window !== "undefined") {
    window.location.assign(url);
  }
}

function TagChip({ tag }: { tag: DocTagOut }) {
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium"
      style={
        tag.color
          ? { backgroundColor: `${tag.color}22`, color: tag.color }
          : undefined
      }
    >
      <span className={tag.color ? "" : "text-muted-foreground bg-muted rounded-full px-2 py-0.5"}>
        {tag.label}
      </span>
    </span>
  );
}

export default function DocumentsHub() {
  const { docs, workspaces, allTags, projectFilter } = useLoaderData() as Exclude<
    Awaited<ReturnType<typeof loader>>,
    Response
  >;
  const [, setSearchParams] = useSearchParams();
  const revalidator = useRevalidator();
  const dialog = useDialog();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<"all" | "lab" | "project">("all");
  const [selectedTagIds, setSelectedTagIds] = useState<Set<string>>(() => new Set());
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(
    () => new Set(docs.filter((d) => d.kind === "Folder").map((d) => d.id)),
  );
  const [collapsedWorkspaces, setCollapsedWorkspaces] = useState<Set<string>>(() => new Set());

  function setProjectFilter(next: ProjectFilter) {
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        if (next === "active") params.delete("projects");
        else params.set("projects", "all");
        return params;
      },
      { replace: true },
    );
  }

  // A rename happens in the doc's own split-screen tab (separate loader). The
  // shell relays `dali:documentTitleChanged` to open tabs — revalidate so the
  // row label here updates without a reload (same pattern as the project hub).
  useEffect(() => {
    const knownIds = new Set(docs.map((d) => d.id));
    function onMessage(e: MessageEvent) {
      if (e.origin !== window.location.origin) return;
      const data = e.data as { type?: string; pageId?: string } | undefined;
      if (data?.type !== "dali:documentTitleChanged") return;
      if (!data.pageId || !knownIds.has(data.pageId)) return;
      revalidator.revalidate();
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [docs, revalidator]);

  const q = query.trim().toLowerCase();
  const filtering = q.length > 0 || selectedTagIds.size > 0;

  function toggleTag(id: string) {
    setSelectedTagIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleFolder(id: string) {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleWorkspace(key: string) {
    setCollapsedWorkspaces((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function post(url: string, body?: unknown, method: "POST" | "DELETE" = "POST") {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(url, {
        method,
        credentials: "include",
        ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
      });
      const b = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
      if (!res.ok) throw new Error(b.error ?? "Something went wrong");
      return b;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function createLabDocument(parentPageId?: string) {
    const title = "Untitled";
    const b = await post("/api/lab-documents", parentPageId ? { title, parentPageId } : { title });
    if (b?.id) {
      openDocumentTab(b.id, title);
      revalidator.revalidate();
    }
  }
  async function createLabFolder() {
    const title = await dialog.prompt({ title: "New folder", label: "Folder name" });
    if (!title || !title.trim()) return;
    const b = await post("/api/lab-documents", { title: title.trim(), kind: "Folder" });
    if (b?.id) {
      setExpandedFolders((prev) => new Set(prev).add(b.id!));
      revalidator.revalidate();
    }
  }
  async function archiveDocument(id: string, title: string, isFolder: boolean) {
    if (
      !(await dialog.confirm({
        title: `Archive ${isFolder ? "folder" : "document"} "${title}"?`,
        confirmLabel: "Archive",
        tone: "destructive",
      }))
    )
      return;
    const b = await post(`/api/documents/${id}`, undefined, "DELETE");
    if (b) revalidator.revalidate();
  }
  async function togglePin(id: string, next: boolean) {
    const b = await post(`/api/pages/${id}/pin`, { pinned: next });
    if (b) revalidator.revalidate();
  }
  // Drag a lab document into a folder (parentPageId = folder id) or back to the
  // top level (null). Folders themselves aren't draggable.
  const [dragDocId, setDragDocId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | "root" | null>(null);
  async function moveDocument(
    id: string,
    parentPageId: string | null,
    beforeId: string | null = null,
  ) {
    setDragDocId(null);
    setDropTarget(null);
    if (id === beforeId) return;
    const b = await post(`/api/pages/${id}/move`, { parentPageId, beforeId });
    if (b) {
      if (parentPageId) setExpandedFolders((prev) => new Set(prev).add(parentPageId));
      revalidator.revalidate();
    }
  }

  const inScope = (kind: "lab" | "project") => scope === "all" || scope === kind;

  const filteredDocs = useMemo(() => {
    if (!filtering) return [];
    return docs
      .filter((d) => d.kind !== "Folder")
      .filter((d) => inScope(d.workspaceKind))
      .filter((d) => (q ? d.title.toLowerCase().includes(q) : true))
      .filter((d) =>
        selectedTagIds.size === 0 ? true : d.tags.some((t) => selectedTagIds.has(t.id)),
      )
      .sort((a, b) => a.title.localeCompare(b.title));
  }, [docs, filtering, q, selectedTagIds, scope]);

  const pinned = useMemo(
    () =>
      docs
        .filter((d) => d.pinned && d.parentPageId === null && inScope(d.workspaceKind))
        .sort((a, b) => (b.pinnedAt ?? 0) - (a.pinnedAt ?? 0)),
    [docs, scope],
  );

  const visibleWorkspaces = useMemo(
    () => workspaces.filter((w) => inScope(w.kind)),
    [workspaces, scope],
  );

  const childrenByParent = useMemo(() => {
    const map = new Map<string, DocOut[]>();
    for (const d of docs) {
      if (!d.parentPageId) continue;
      const list = map.get(d.parentPageId);
      if (list) list.push(d);
      else map.set(d.parentPageId, [d]);
    }
    return map;
  }, [docs]);

  const canManageByWorkspace = useMemo(
    () => new Map(workspaces.map((w) => [w.key, w.canManage])),
    [workspaces],
  );
  const canManageLab = canManageByWorkspace.get("lab") ?? false;

  function DocRow({
    doc,
    indent,
    parentId = null,
  }: {
    doc: DocOut;
    indent: boolean;
    parentId?: string | null;
  }) {
    const canManage = canManageByWorkspace.get(doc.workspaceKey) ?? false;
    const canArchive = canManage && doc.workspaceKind === "lab" && !doc.isSystem;
    const draggable = canManage && doc.workspaceKind === "lab";
    return (
      <div
        draggable={draggable}
        onDragStart={
          draggable
            ? (e) => {
                setDragDocId(doc.id);
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", doc.id);
              }
            : undefined
        }
        onDragEnd={draggable ? () => setDragDocId(null) : undefined}
        onDragOver={
          draggable && dragDocId
            ? (e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                if (dropTarget !== doc.id) setDropTarget(doc.id);
              }
            : undefined
        }
        onDragLeave={
          draggable ? () => setDropTarget((t) => (t === doc.id ? null : t)) : undefined
        }
        onDrop={
          draggable && dragDocId
            ? (e) => {
                e.preventDefault();
                e.stopPropagation();
                void moveDocument(dragDocId, parentId, doc.id);
              }
            : undefined
        }
        className={`py-2.5 flex items-center justify-between gap-3 text-sm ${indent ? "pl-6" : ""} ${
          draggable ? "cursor-grab active:cursor-grabbing" : ""
        } ${dragDocId === doc.id ? "opacity-50" : ""} ${
          dragDocId && dropTarget === doc.id ? "border-t-2 border-accent-coral" : ""
        }`}
      >
        <button
          type="button"
          onClick={() => openDocumentTab(doc.id, doc.title)}
          className="flex items-center gap-2 min-w-0 text-left font-medium text-foreground hover:text-accent-coral"
        >
          <PageIcon iconEmoji={doc.iconEmoji} />
          <span className="truncate">{doc.title}</span>
        </button>
        <div className="flex items-center gap-2 flex-shrink-0">
          {doc.tags.map((t) => (
            <TagChip key={t.id} tag={t} />
          ))}
          {canManage && !indent && (
            <Tooltip label={doc.pinned ? "Pinned — click to unpin" : "Pin to top"}>
              <button
                type="button"
                disabled={busy}
                onClick={() => void togglePin(doc.id, !doc.pinned)}
                aria-label={doc.pinned ? "Unpin document" : "Pin document"}
                aria-pressed={doc.pinned}
                className={`flex items-center disabled:opacity-60 ${
                  doc.pinned ? "text-accent-coral" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Pin className={`w-3.5 h-3.5 ${doc.pinned ? "fill-current" : ""}`} />
              </button>
            </Tooltip>
          )}
          {canArchive && (
            <Tooltip label="Archive document">
              <button
                type="button"
                disabled={busy}
                onClick={() => void archiveDocument(doc.id, doc.title, false)}
                aria-label="Archive document"
                className="text-muted-foreground hover:text-foreground disabled:opacity-60"
              >
                <Archive className="w-3.5 h-3.5" />
              </button>
            </Tooltip>
          )}
        </div>
      </div>
    );
  }

  function FolderRow({ doc, canManage }: { doc: DocOut; canManage: boolean }) {
    const children = childrenByParent.get(doc.id) ?? [];
    const canArchive = canManage && doc.workspaceKind === "lab" && !doc.isSystem;
    const isDropZone = canManage && doc.workspaceKind === "lab";
    const dropActive = dropTarget === doc.id;
    return (
      <div className="py-2.5 flex flex-col gap-1">
        <div
          onDragOver={
            isDropZone && dragDocId
              ? (e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  if (dropTarget !== doc.id) setDropTarget(doc.id);
                }
              : undefined
          }
          onDragLeave={
            isDropZone ? () => setDropTarget((t) => (t === doc.id ? null : t)) : undefined
          }
          onDrop={
            isDropZone && dragDocId
              ? (e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (dragDocId !== doc.id) void moveDocument(dragDocId, doc.id);
                }
              : undefined
          }
          className={`flex items-center justify-between gap-3 text-sm rounded-md ${
            dropActive ? "ring-2 ring-accent-coral/60 bg-accent-coral/5" : ""
          }`}
        >
          <button
            type="button"
            onClick={() => toggleFolder(doc.id)}
            className="flex items-center gap-1.5 text-left font-medium text-foreground min-w-0"
          >
            {expandedFolders.has(doc.id) ? (
              <ChevronDown className="w-3.5 h-3.5 flex-shrink-0 text-muted-foreground" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5 flex-shrink-0 text-muted-foreground" />
            )}
            <Folder className="w-3.5 h-3.5 flex-shrink-0 text-muted-foreground" />
            <span className="truncate">{doc.title}</span>
            {doc.isSystem && (
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground/70 flex-shrink-0">
                Default
              </span>
            )}
          </button>
          {canManage && (
            <div className="flex items-center gap-2 flex-shrink-0">
              <Tooltip label={doc.pinned ? "Pinned — click to unpin" : "Pin to top"}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void togglePin(doc.id, !doc.pinned)}
                  aria-label={doc.pinned ? "Unpin folder" : "Pin folder"}
                  aria-pressed={doc.pinned}
                  className={`flex items-center disabled:opacity-60 ${
                    doc.pinned ? "text-accent-coral" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Pin className={`w-3.5 h-3.5 ${doc.pinned ? "fill-current" : ""}`} />
                </button>
              </Tooltip>
              {doc.workspaceKind === "lab" && (
                <Tooltip label="Add document to folder">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void createLabDocument(doc.id)}
                    aria-label="Add document to folder"
                    className="flex items-center text-accent-coral hover:text-accent-coral/80 disabled:opacity-60"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                </Tooltip>
              )}
              {canArchive && (
                <button
                  type="button"
                  disabled={busy || children.length > 0}
                  title={
                    children.length > 0
                      ? "Move or archive the documents inside this folder first"
                      : "Archive folder"
                  }
                  aria-label="Archive folder"
                  onClick={() => void archiveDocument(doc.id, doc.title, true)}
                  className="p-1 rounded text-muted-foreground hover:text-foreground disabled:opacity-60"
                >
                  <Archive className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          )}
        </div>
        {expandedFolders.has(doc.id) &&
          (children.length === 0 ? (
            <p className="pl-6 text-xs text-muted-foreground italic">Empty</p>
          ) : (
            <div className="flex flex-col divide-y divide-border">
              {children.map((child) => (
                <DocRow key={child.id} doc={child} indent parentId={doc.id} />
              ))}
            </div>
          ))}
      </div>
    );
  }

  function WorkspaceGroup({ workspace }: { workspace: WorkspaceOut }) {
    const topLevel = docs.filter(
      (d) => d.workspaceKey === workspace.key && d.parentPageId === null && !d.pinned,
    );
    const isLab = workspace.kind === "lab";
    // Lab-wide is a flat list with no header of its own — its "Add document"
    // action lives in the page header. Project groups keep the collapsible
    // folder styling since their docs nest.
    const collapsed = !isLab && collapsedWorkspaces.has(workspace.key);
    return (
      <section
        className={`bg-card border border-border rounded-lg px-4 ${
          isLab ? "py-1.5" : collapsed ? "py-2.5" : "py-4"
        }`}
      >
        {!isLab && (
          <div className={`flex items-center justify-between ${collapsed ? "" : "mb-3"}`}>
            <button
              type="button"
              onClick={() => toggleWorkspace(workspace.key)}
              className="flex items-center gap-2 text-sm font-semibold text-foreground min-w-0"
            >
              {collapsed ? (
                <ChevronRight className="w-4 h-4 flex-shrink-0 text-muted-foreground" />
              ) : (
                <ChevronDown className="w-4 h-4 flex-shrink-0 text-muted-foreground" />
              )}
              <ProjectIcon iconEmoji={workspace.projectIconEmoji} />
              <span className="truncate">{workspace.label}</span>
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground/70 flex-shrink-0">
                Project
              </span>
              {workspace.projectStatus && workspace.projectStatus !== "Active" && (
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground border border-border rounded px-1.5 py-0.5 flex-shrink-0">
                  {workspace.projectStatus}
                </span>
              )}
            </button>
          </div>
        )}
        {!collapsed &&
          (topLevel.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">No documents yet.</p>
          ) : (
            <div
              onDragOver={
                isLab && workspace.canManage && dragDocId
                  ? (e) => {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = "move";
                      if (dropTarget !== "root") setDropTarget("root");
                    }
                  : undefined
              }
              onDragLeave={
                isLab && workspace.canManage
                  ? () => setDropTarget((t) => (t === "root" ? null : t))
                  : undefined
              }
              onDrop={
                isLab && workspace.canManage && dragDocId
                  ? (e) => {
                      e.preventDefault();
                      void moveDocument(dragDocId, null);
                    }
                  : undefined
              }
              className={`flex flex-col divide-y divide-border rounded-md ${
                dropTarget === "root" ? "ring-2 ring-accent-coral/40" : ""
              }`}
            >
              {topLevel.map((doc) =>
                doc.kind === "Folder" ? (
                  <FolderRow key={doc.id} doc={doc} canManage={workspace.canManage} />
                ) : (
                  <DocRow key={doc.id} doc={doc} indent={false} />
                ),
              )}
            </div>
          ))}
      </section>
    );
  }

  return (
    <div className="w-full flex flex-col gap-4 p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <FileText className="w-5 h-5 text-accent-coral" />
          <h1 className="text-lg font-semibold text-foreground">Documents</h1>
        </div>
        {canManageLab && (
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              type="button"
              disabled={busy}
              onClick={() => void createLabFolder()}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted disabled:opacity-60"
            >
              <FolderPlus className="w-4 h-4" /> New folder
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void createLabDocument()}
              className="inline-flex items-center gap-1.5 rounded-md bg-accent-coral px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-coral/90 disabled:opacity-60"
            >
              <Plus className="w-4 h-4" /> New document
            </button>
          </div>
        )}
      </div>

      {/* Filter bar: search + scope toggle on one row, tag chips below */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[16rem]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search documents…"
              className="w-full rounded-md border border-border bg-background pl-9 pr-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/40"
            />
          </div>
          <div className="inline-flex rounded-md border border-border bg-card p-0.5 text-sm">
            {([
              ["active", "Active"],
              ["all", "All"],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setProjectFilter(value)}
                aria-pressed={projectFilter === value}
                className={`px-3 py-1 rounded font-medium transition-colors ${
                  projectFilter === value
                    ? "bg-accent-coral/10 text-accent-coral"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="inline-flex rounded-md border border-border bg-card p-0.5 text-sm">
            {([
              ["all", "All"],
              ["lab", "Lab-wide"],
              ["project", "Projects"],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setScope(value)}
                aria-pressed={scope === value}
                className={`px-3 py-1 rounded font-medium transition-colors ${
                  scope === value
                    ? "bg-accent-coral/10 text-accent-coral"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        {allTags.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            <TagIcon className="w-3.5 h-3.5 text-muted-foreground" />
            {allTags.map((tag) => {
              const active = selectedTagIds.has(tag.id);
              return (
                <button
                  key={tag.id}
                  type="button"
                  onClick={() => toggleTag(tag.id)}
                  aria-pressed={active}
                  className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium border transition-colors ${
                    active
                      ? "border-accent-coral bg-accent-coral/10 text-accent-coral"
                      : "border-border text-muted-foreground hover:text-foreground hover:border-foreground/30"
                  }`}
                >
                  {tag.label}
                </button>
              );
            })}
            {selectedTagIds.size > 0 && (
              <button
                type="button"
                onClick={() => setSelectedTagIds(new Set())}
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                <X className="w-3 h-3" /> Clear
              </button>
            )}
          </div>
        )}
      </div>

      {error && (
        <div className="bg-destructive/10 border border-destructive/30 text-destructive text-xs rounded-md px-3 py-2">
          {error}
        </div>
      )}

      {filtering ? (
        <section className="bg-card border border-border rounded-lg p-4">
          <h2 className="text-sm font-semibold text-foreground mb-3">
            {filteredDocs.length} {filteredDocs.length === 1 ? "result" : "results"}
          </h2>
          {filteredDocs.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">No documents match your filters.</p>
          ) : (
            <div className="flex flex-col divide-y divide-border">
              {filteredDocs.map((doc) => (
                <div key={doc.id} className="flex flex-col">
                  <DocRow doc={doc} indent={false} />
                  <span className="pl-6 -mt-1.5 mb-1 text-[11px] text-muted-foreground">
                    {doc.workspaceLabel}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      ) : (
        <>
          {pinned.length > 0 && (
            <section className="bg-card border border-border rounded-lg p-4">
              <h2 className="text-sm font-semibold text-foreground flex items-center gap-2 mb-3">
                <Pin className="w-4 h-4 fill-current text-accent-coral" /> Pinned
              </h2>
              <div className="flex flex-col divide-y divide-border">
                {pinned.map((doc) => (
                  <div key={doc.id} className="flex flex-col">
                    {doc.kind === "Folder" ? (
                      <FolderRow
                        doc={doc}
                        canManage={canManageByWorkspace.get(doc.workspaceKey) ?? false}
                      />
                    ) : (
                      <DocRow doc={doc} indent={false} />
                    )}
                    <span className="pl-6 -mt-1.5 mb-1 text-[11px] text-muted-foreground">
                      {doc.workspaceLabel}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}
          {visibleWorkspaces.map((workspace) => (
            <WorkspaceGroup key={workspace.key} workspace={workspace} />
          ))}
        </>
      )}
    </div>
  );
}
