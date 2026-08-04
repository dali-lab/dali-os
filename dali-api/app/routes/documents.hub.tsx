import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import {
  redirect,
  useLoaderData,
  useNavigate,
  useRevalidator,
  useSearchParams,
} from "react-router";
import type { Route } from "./+types/documents.hub";
import {
  Archive,
  ChevronDown,
  ChevronRight,
  Copy,
  FileText,
  Folder,
  FolderInput,
  FolderPlus,
  LayoutTemplate,
  Lock,
  Pin,
  Plus,
  Search,
  Tag as TagIcon,
  X,
} from "lucide-react";
import { prisma } from "~/lib/db";
import { requireAuth, redirectPartnerToPortal } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { isCore, isLabMember, currentTerm } from "~/lib/roles";
import { visibleLabDocFilter } from "~/lib/lab-documents.server";
import { Tooltip } from "~/components/ui/IconButton";
import { useDialog } from "~/components/ui/dialog";
import { PageIcon } from "~/components/PageIcon";
import { ProjectIcon } from "~/components/ProjectIcon";
import { MoveToDialog } from "~/components/sharing/MoveToDialog";
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
  /** Lab docs only: narrowed to its creator + share list rather than the whole
   *  lab. Drives the lock badge. */
  restricted: boolean;
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
  if (!auth.ok) return redirectToLogin(request);
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
  // Restricted lab docs drop out of the list for everyone but their creator,
  // the people they're shared with, and Core.
  const labVisibility = core ? {} : await visibleLabDocFilter(auth.user.sub);

  const [labPages, projects] = await Promise.all([
    prisma.page.findMany({
      where: {
        workspaceType: "Lab",
        workspaceId: null,
        archivedAt: null,
        ...labVisibility,
      },
      orderBy: { position: "asc" },
      select: { ...pageSelect, createdById: true, labRestricted: true },
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
    // Lab rows carry createdById/labRestricted; project rows don't select them
    // and don't need them — access for project docs is the project's business.
    p: Omit<(typeof labPages)[number], "createdById" | "labRestricted"> & {
      workspaceId?: string | null;
      createdById?: string;
      labRestricted?: boolean;
    },
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
    restricted: workspaceKind === "lab" && p.labRestricted === true,
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
  const navigate = useNavigate();
  const dialog = useDialog();
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false);
  const [labTemplates, setLabTemplates] = useState<Array<{ id: string; title: string; iconEmoji: string | null }> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<"all" | "lab" | "project">("all");
  const [newMenuOpen, setNewMenuOpen] = useState(false);
  const newMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!newMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (newMenuRef.current && !newMenuRef.current.contains(e.target as Node)) {
        setNewMenuOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setNewMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [newMenuOpen]);
  const [selectedTagIds, setSelectedTagIds] = useState<Set<string>>(() => new Set());
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(
    () => new Set(docs.filter((d) => d.kind === "Folder").map((d) => d.id)),
  );
  // Projects collapsed by default — see ProjectFolderRow. Lab-wide docs are
  // never in this set; they're the top level of the tree, not a workspace.
  const [collapsedWorkspaces, setCollapsedWorkspaces] = useState<Set<string>>(
    () => new Set(workspaces.filter((w) => w.kind === "project").map((w) => w.key)),
  );

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

  const openTemplatePicker = useCallback(async () => {
    setTemplatePickerOpen(true);
    if (labTemplates !== null) return;
    const res = await fetch("/api/page-templates?workspaceType=Lab", { credentials: "include" });
    if (res.ok) {
      const data = (await res.json()) as { templates: Array<{ id: string; title: string; iconEmoji: string | null }> };
      setLabTemplates(data.templates);
    } else {
      setLabTemplates([]);
    }
  }, [labTemplates]);

  async function createFromTemplate(templatePageId: string) {
    setTemplatePickerOpen(false);
    const b = await post("/api/page-templates", {
      templatePageId,
      targetWorkspaceType: "Lab",
      targetWorkspaceId: null,
    });
    if (b?.id) {
      revalidator.revalidate();
      navigate(`/documents/${b.id}`);
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
  async function duplicateDocument(id: string) {
    const b = await post(`/api/pages/${id}/duplicate`);
    if (b?.id) {
      revalidator.revalidate();
      navigate(`/documents/${b.id}`);
    }
  }
  // "Move to…" dialog state. workspaceType/workspaceId track the doc's current
  // workspace so MoveToDialog can pre-select the right destination.
  const [moveDoc, setMoveDoc] = useState<{
    id: string;
    title: string;
    workspaceType: string;
    workspaceId: string | null;
  } | null>(null);

  // Drag a document into a folder or back to the top level (lab-only before;
  // now all workspaces are draggable — cross-workspace drops confirm first).
  const [dragDocId, setDragDocId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | "root" | null>(null);
  async function moveDocument(
    id: string,
    parentPageId: string | null,
    beforeId: string | null = null,
    destWorkspaceKey?: string,
  ) {
    const src = docs.find((d) => d.id === id);
    const srcKey = src?.workspaceKey;

    // Cross-workspace: confirm before posting.
    if (destWorkspaceKey && srcKey && destWorkspaceKey !== srcKey) {
      const destWorkspace = workspaces.find((w) => w.key === destWorkspaceKey);
      const leavingProject = src?.workspaceKind === "project";
      const confirmed = await dialog.confirm({
        title: `Move "${src?.title}" to ${destWorkspace?.label ?? destWorkspaceKey}?`,
        description:
          `People with access where it is now will lose it; people in the destination will gain access.` +
          (leavingProject ? " Partner and public sharing will be turned off." : ""),
        confirmLabel: "Move",
      });
      if (!confirmed) {
        setDragDocId(null);
        setDropTarget(null);
        return;
      }
    }

    setDragDocId(null);
    setDropTarget(null);
    if (id === beforeId) return;

    const destPayload =
      destWorkspaceKey && srcKey && destWorkspaceKey !== srcKey
        ? destWorkspaceKey === "lab"
          ? { workspaceType: "Lab", workspaceId: null }
          : { workspaceType: "Project", workspaceId: destWorkspaceKey }
        : {};

    const b = await post(`/api/pages/${id}/move`, { parentPageId, beforeId, ...destPayload });
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
    // All manageable, non-system docs are draggable; project docs can cross
    // workspaces (the drop handler confirms before posting).
    const draggable = canManage && !doc.isSystem;
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
          dragDocId && dragDocId !== doc.id
            ? (e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                if (dropTarget !== doc.id) setDropTarget(doc.id);
              }
            : undefined
        }
        onDragLeave={
          dragDocId ? () => setDropTarget((t) => (t === doc.id ? null : t)) : undefined
        }
        onDrop={
          dragDocId && dragDocId !== doc.id
            ? (e) => {
                e.preventDefault();
                e.stopPropagation();
                void moveDocument(dragDocId, parentId, doc.id, doc.workspaceKey);
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
          {doc.restricted && (
            <Tooltip label="Restricted — only the people it's shared with">
              <Lock className="w-3 h-3 flex-shrink-0 text-muted-foreground" />
            </Tooltip>
          )}
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
          {canManage && (
            <Tooltip label="Duplicate">
              <button
                type="button"
                disabled={busy}
                onClick={() => void duplicateDocument(doc.id)}
                aria-label="Duplicate document"
                className="text-muted-foreground hover:text-foreground disabled:opacity-60"
              >
                <Copy className="w-3.5 h-3.5" />
              </button>
            </Tooltip>
          )}
          {canManage && !doc.isSystem && (
            <Tooltip label="Move to…">
              <button
                type="button"
                onClick={() =>
                  setMoveDoc({
                    id: doc.id,
                    title: doc.title,
                    workspaceType: doc.workspaceKind === "lab" ? "Lab" : "Project",
                    workspaceId: doc.workspaceKind === "lab" ? null : doc.workspaceKey,
                  })
                }
                aria-label="Move document"
                className="text-muted-foreground hover:text-foreground disabled:opacity-60"
              >
                <FolderInput className="w-3.5 h-3.5" />
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
    const isDropZone = canManage;
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
                  if (dragDocId !== doc.id)
                    void moveDocument(dragDocId, doc.id, null, doc.workspaceKey);
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
            {doc.restricted && (
              <Lock className="w-3 h-3 flex-shrink-0 text-muted-foreground" />
            )}
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

  // One tree, not one card per workspace. Lab-wide documents are the top level
  // — the hub is the lab's shelf — and each project hangs off it as a folder,
  // closed until asked for. Splitting them into separate bordered sections made
  // two lists of the same thing and pushed the lab's own documents down the page
  // by however many projects you happen to be on.
  function UnifiedTree({ workspaces }: { workspaces: WorkspaceOut[] }) {
    const lab = workspaces.find((w) => w.kind === "lab");
    const projects = workspaces.filter((w) => w.kind === "project");
    const labTopLevel = docs.filter(
      (d) => d.workspaceKind === "lab" && d.parentPageId === null && !d.pinned,
    );
    const labCanManage = lab?.canManage ?? false;
    const isEmpty = labTopLevel.length === 0 && projects.length === 0;

    return (
      <section className="bg-card border border-border rounded-lg px-4 py-1.5">
        {isEmpty ? (
          <p className="py-6 text-sm text-muted-foreground italic">No documents yet.</p>
        ) : (
          <div
            // Dropping on the tree's empty space moves a lab doc back to the
            // root. Project rows stop propagation, so this only ever catches
            // the lab level.
            onDragOver={
              labCanManage && dragDocId
                ? (e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                    if (dropTarget !== "root") setDropTarget("root");
                  }
                : undefined
            }
            onDragLeave={
              labCanManage ? () => setDropTarget((t) => (t === "root" ? null : t)) : undefined
            }
            onDrop={
              labCanManage && dragDocId
                ? (e) => {
                    e.preventDefault();
                    void moveDocument(dragDocId, null, null, "lab");
                  }
                : undefined
            }
            className={`flex flex-col divide-y divide-border rounded-md ${
              dropTarget === "root" ? "ring-2 ring-accent-coral/40" : ""
            }`}
          >
            {labTopLevel.map((doc) =>
              doc.kind === "Folder" ? (
                <FolderRow key={doc.id} doc={doc} canManage={labCanManage} />
              ) : (
                <DocRow key={doc.id} doc={doc} indent={false} />
              ),
            )}
            {projects.map((w) => (
              <ProjectFolderRow key={w.key} workspace={w} />
            ))}
          </div>
        )}
      </section>
    );
  }

  // A project rendered as a folder in the lab tree. Same row grammar as
  // FolderRow so the tree reads as one structure, but tinted with the project
  // accent and carrying the project's own icon — a project is a different kind
  // of container from a folder somebody made, and the colour is what says so
  // without a second label.
  function ProjectFolderRow({ workspace }: { workspace: WorkspaceOut }) {
    const open = !collapsedWorkspaces.has(workspace.key);
    const topLevel = docs.filter(
      (d) => d.workspaceKey === workspace.key && d.parentPageId === null && !d.pinned,
    );
    const dropActive = dropTarget === workspace.key;
    return (
      <div
        onDragOver={
          dragDocId
            ? (e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                if (dropTarget !== workspace.key) setDropTarget(workspace.key);
              }
            : undefined
        }
        onDragLeave={
          dragDocId
            ? () => setDropTarget((t) => (t === workspace.key ? null : t))
            : undefined
        }
        onDrop={
          dragDocId
            ? (e) => {
                e.preventDefault();
                e.stopPropagation();
                void moveDocument(dragDocId, null, null, workspace.key);
              }
            : undefined
        }
        className={`py-2.5 flex flex-col gap-1 ${dropActive ? "ring-2 ring-accent-coral/40 rounded-md" : ""}`}
      >
        <button
          type="button"
          onClick={() => toggleWorkspace(workspace.key)}
          aria-expanded={open}
          className="flex items-center gap-1.5 text-left text-sm font-medium text-foreground min-w-0"
        >
          {open ? (
            <ChevronDown className="w-3.5 h-3.5 flex-shrink-0 text-accent-coral" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 flex-shrink-0 text-accent-coral" />
          )}
          {/* ProjectIcon is the only glyph here: it shows the project's emoji,
              or falls back to a folder itself, so pairing it with a Folder icon
              drew two folders in a row. */}
          <ProjectIcon iconEmoji={workspace.projectIconEmoji} />
          <span className="truncate">{workspace.label}</span>
          <span className="text-[10px] uppercase tracking-wide text-accent-coral/70 flex-shrink-0">
            Project
          </span>
          {workspace.projectStatus && workspace.projectStatus !== "Active" && (
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground border border-border rounded px-1.5 py-0.5 flex-shrink-0">
              {workspace.projectStatus}
            </span>
          )}
          {!open && topLevel.length > 0 && (
            <span className="text-[11px] text-muted-foreground flex-shrink-0">
              ({topLevel.length})
            </span>
          )}
        </button>
        {open && (
          <div className="pl-6 flex flex-col divide-y divide-border">
            {topLevel.length === 0 ? (
              <p className="py-1.5 text-sm text-muted-foreground italic">No documents yet.</p>
            ) : (
              topLevel.map((doc) =>
                doc.kind === "Folder" ? (
                  <FolderRow key={doc.id} doc={doc} canManage={workspace.canManage} />
                ) : (
                  <DocRow key={doc.id} doc={doc} indent={false} />
                ),
              )
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="w-full flex flex-col gap-4 p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <FileText className="w-5 h-5 text-accent-coral" />
          <h1 className="text-lg font-semibold text-foreground">Documents</h1>
        </div>
        {/* One primary action with the two rarer ways to create attached to it,
            rather than three same-sized buttons competing for the same corner.
            Split button: the left half does the common thing outright, the
            chevron opens the alternatives. */}
        {canManageLab && (
          <div ref={newMenuRef} className="relative flex-shrink-0">
            <div className="inline-flex overflow-hidden rounded-md">
              <button
                type="button"
                disabled={busy}
                onClick={() => void createLabDocument()}
                className="inline-flex items-center gap-1.5 bg-accent-coral px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-coral/90 disabled:opacity-60"
              >
                <Plus className="w-4 h-4" /> New document
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => setNewMenuOpen((o) => !o)}
                aria-haspopup="menu"
                aria-expanded={newMenuOpen}
                aria-label="More ways to add"
                className="inline-flex items-center border-l border-white/25 bg-accent-coral px-1.5 py-1.5 text-white hover:bg-accent-coral/90 disabled:opacity-60"
              >
                <ChevronDown className="w-4 h-4" />
              </button>
            </div>
            {newMenuOpen && (
              <div
                role="menu"
                className="absolute right-0 z-30 mt-1 w-52 rounded-md border border-border bg-card p-1 shadow-brand-2"
              >
                <button
                  type="button"
                  role="menuitem"
                  disabled={busy}
                  onClick={() => {
                    setNewMenuOpen(false);
                    void createLabFolder();
                  }}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-foreground hover:bg-muted disabled:opacity-60"
                >
                  <FolderPlus className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
                  New folder
                </button>
                <button
                  type="button"
                  role="menuitem"
                  disabled={busy}
                  onClick={() => {
                    setNewMenuOpen(false);
                    void openTemplatePicker();
                  }}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-foreground hover:bg-muted disabled:opacity-60"
                >
                  <LayoutTemplate className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
                  From template…
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Template picker dropdown */}
      {templatePickerOpen && (
        <div
          className="fixed inset-0 z-40 flex items-start justify-end pt-16 pr-4"
          onClick={(e) => { if (e.target === e.currentTarget) setTemplatePickerOpen(false); }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Choose a template"
            className="w-72 rounded-lg border border-border bg-card shadow-brand-2 overflow-hidden"
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <span className="text-sm font-semibold text-foreground">Start from template</span>
              <button
                type="button"
                onClick={() => setTemplatePickerOpen(false)}
                aria-label="Close"
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="max-h-64 overflow-y-auto p-2">
              {labTemplates === null ? (
                <p className="px-2 py-4 text-sm text-muted-foreground text-center">Loading…</p>
              ) : labTemplates.length === 0 ? (
                <p className="px-2 py-4 text-sm text-muted-foreground text-center italic">
                  No lab-wide templates yet. Mark a document as a template from its ⋯ menu.
                </p>
              ) : (
                <ul className="flex flex-col gap-0.5">
                  {labTemplates.map((tpl) => (
                    <li key={tpl.id}>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void createFromTemplate(tpl.id)}
                        className="w-full flex items-center gap-2 px-2.5 py-2 rounded-md text-left text-sm text-foreground hover:bg-muted disabled:opacity-60"
                      >
                        <PageIcon iconEmoji={tpl.iconEmoji} />
                        <span className="truncate">{tpl.title}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}

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
          {scope !== "lab" && (
            <div className="inline-flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Projects</span>
              <div className="inline-flex rounded-md border border-border bg-card p-0.5 text-sm">
                {([
                  ["active", "This term"],
                  ["all", "All time"],
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
            </div>
          )}
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
          <UnifiedTree workspaces={visibleWorkspaces} />
        </>
      )}

      <MoveToDialog
        open={!!moveDoc}
        pageId={moveDoc?.id ?? ""}
        title={moveDoc?.title ?? ""}
        current={{ type: moveDoc?.workspaceType ?? "Lab", id: moveDoc?.workspaceId ?? null }}
        onClose={() => setMoveDoc(null)}
        onMoved={() => {
          setMoveDoc(null);
          revalidator.revalidate();
        }}
      />
    </div>
  );
}
