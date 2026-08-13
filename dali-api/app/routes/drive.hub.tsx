import { redirect, useLoaderData, useSearchParams, useRevalidator } from "react-router";
import type { Route } from "./+types/drive.hub";
import {
  HardDrive,
  FileText,
  ClipboardList,
  FileSignature,
  Paperclip,
  FolderOpen,
  Plus,
  Users,
  ChevronDown,
  Folder as FolderIcon,
  LayoutTemplate,
  Upload,
  User,
  Shield,
} from "lucide-react";
import { useState, useCallback, useEffect, useRef, useId, useMemo } from "react";
import { requireAuth, redirectPartnerToPortal } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { canViewForms as checkCanViewForms, getUserRoles } from "~/lib/roles";
import { loader as docsLoader } from "~/routes/documents.hub";
import { loadDriveScopes } from "~/lib/drive-scopes.server";
import type { DriveItem } from "~/lib/drive.server";
import { DriveTree } from "~/components/drive/DriveTree";
import type { DriveTreeMoveArgs, RowActions } from "~/components/drive/DriveTree";
import { useDialog } from "~/components/ui/dialog";
import { useToast } from "~/components/ui/toast";
import { Menu } from "~/components/ui/floating";
import { Modal } from "~/components/Modal";

export const meta: Route.MetaFunction = () => [{ title: "Drive · DALI OS" }];

// The unified Drive hub, surfaced when the drive-consolidation feature flag is
// on. Browse is the only main view. Type filter chips (All · Documents · Files ·
// Forms) filter the tree. The New ▾ menu includes real upload and from-template
// flows. Agreements and Templates shelves have been removed: signed agreements
// stay in Settings → Agreements; templates are now a creation aid in the New
// menu only.
export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  if (auth.user.type === "applicant") return redirect("/portal");
  const partnerRedirect = await redirectPartnerToPortal(auth);
  if (partnerRedirect) return partnerRedirect;

  const roles = await getUserRoles(auth.user.sub);
  const userCanViewForms = await checkCanViewForms(auth.user.sub);
  // isCore is the gate for agreement authoring. Passed down as canManageAgreements
  // so drive.server.ts doesn't re-derive it (matches the canViewForms pattern).
  const userCanManageAgreements = roles.isCore;

  const docsResult = await docsLoader({ request } as Parameters<typeof docsLoader>[0]);
  if (docsResult instanceof Response) return docsResult;

  const projectWorkspaces = docsResult.workspaces.filter((w) => w.kind === "project");

  const driveScopes = await loadDriveScopes({
    userSub: auth.user.sub,
    projectWorkspaces,
    canViewForms: userCanViewForms,
    canManageAgreements: userCanManageAgreements,
    isCore: roles.isCore,
    request,
  });

  return {
    driveScopes,
    canViewForms: userCanViewForms,
    canManageAgreements: userCanManageAgreements,
  };
}

type LoaderData = Exclude<Awaited<ReturnType<typeof loader>>, Response>;
type DriveScope = LoaderData["driveScopes"][number];

// ── Type filter ────────────────────────────────────────────────────────────────

export type DriveTypeFilter = "all" | "doc" | "file" | "form" | "agreement";

const TYPE_FILTERS: {
  value: DriveTypeFilter;
  label: string;
  icon: React.ReactNode;
  /** When set, chip is only visible if the viewer holds this capability. */
  requiresCap?: "canViewForms" | "canManageAgreements";
}[] = [
  { value: "all", label: "All", icon: null },
  { value: "doc", label: "Documents", icon: <FileText className="w-3.5 h-3.5" /> },
  { value: "file", label: "Files", icon: <Paperclip className="w-3.5 h-3.5" /> },
  { value: "form", label: "Forms", icon: <ClipboardList className="w-3.5 h-3.5" />, requiresCap: "canViewForms" },
  { value: "agreement", label: "Agreements", icon: <FileSignature className="w-3.5 h-3.5" />, requiresCap: "canManageAgreements" },
];

// ── Template picker ────────────────────────────────────────────────────────────

// Page templates only — email/signing/mentor template systems stay in their
// admin homes. Opens as a modal so it doesn't require a submenu.
function TemplatePicker({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const titleId = useId();
  const [templates, setTemplates] = useState<{ id: string; title: string; iconEmoji: string | null }[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState<string | null>(null);
  const fetched = useRef(false);

  // Fetch once on first open.
  const onModalOpen = useCallback(async () => {
    if (fetched.current) return;
    fetched.current = true;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/page-templates?workspaceType=Lab", {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to load templates");
      const data = await res.json() as { templates: { id: string; title: string; iconEmoji: string | null }[] };
      setTemplates(data.templates);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load templates");
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch on first open; `fetched` ref inside onModalOpen deduplicates across
  // StrictMode double-invocations.
  useEffect(() => {
    if (open) void onModalOpen();
  }, [open, onModalOpen]);

  async function selectTemplate(templateId: string) {
    setCreating(templateId);
    try {
      const res = await fetch("/api/page-templates", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templatePageId: templateId, targetWorkspaceType: "Lab" }),
      });
      if (!res.ok) throw new Error("Failed to create from template");
      const { id } = await res.json() as { id: string };
      window.location.assign(`/documents/${id}`);
    } catch {
      setCreating(null);
    }
  }

  return (
    <Modal open={open} onClose={onClose} labelledBy={titleId}>
      <h2 id={titleId} className="text-base font-semibold text-foreground mb-4">
        From template
      </h2>
      {loading && (
        <p className="text-sm text-muted-foreground py-6 text-center">Loading templates…</p>
      )}
      {error && (
        <p className="text-sm text-red-600 py-2">{error}</p>
      )}
      {!loading && !error && templates.length === 0 && (
        <p className="text-sm text-muted-foreground italic py-4 text-center">
          No page templates are available in the Lab drive yet.
        </p>
      )}
      {!loading && templates.length > 0 && (
        <ul className="flex flex-col gap-1.5 max-h-72 overflow-y-auto -mx-1 px-1">
          {templates.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                disabled={creating !== null}
                onClick={() => void selectTemplate(t.id)}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left hover:bg-muted/60 transition-colors disabled:opacity-50"
              >
                {t.iconEmoji ? (
                  <span className="text-base leading-none shrink-0">{t.iconEmoji}</span>
                ) : (
                  <LayoutTemplate className="w-4 h-4 text-muted-foreground shrink-0" />
                )}
                <span className="text-sm font-medium text-foreground truncate">
                  {t.title || "Untitled template"}
                </span>
                {creating === t.id && (
                  <span className="ml-auto text-xs text-muted-foreground shrink-0">Creating…</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-4 flex justify-end">
        <button
          type="button"
          onClick={onClose}
          className="text-sm text-muted-foreground hover:text-foreground px-3 py-1.5 rounded-md hover:bg-muted/40 transition-colors"
        >
          Cancel
        </button>
      </div>
    </Modal>
  );
}

// ── File upload helper ─────────────────────────────────────────────────────────

// Hidden <input type="file"> that drives the upload flow: presign → PUT S3 →
// POST /api/drive/files, registering the file in the given drive target (a scope
// plus optional folder). Reuses the same presign pattern as AssignmentWorkArea
// and ProjectImageBanner. Returns the file input ref so a Menu item can click it.
type UploadScope =
  | { kind: "Lab" }
  | { kind: "Member" }
  | { kind: "Project"; projectId: string };

type UploadTarget = { scope: UploadScope; folderPageId?: string | null };

function useDriveFileUpload(target: UploadTarget, onComplete: () => void) {
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    // Reset the input so the same file can be re-selected after an error.
    e.target.value = "";

    setUploading(true);
    setUploadError(null);
    try {
      const key = `drive-files/${crypto.randomUUID()}-${file.name}`;
      const presignRes = await fetch("/api/upload/presign", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key,
          contentType: file.type || "application/octet-stream",
          contentLength: file.size,
        }),
      });
      if (!presignRes.ok) {
        const body = await presignRes.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? "Failed to get upload URL");
      }
      const { url, fields, key: s3Key } = await presignRes.json() as {
        url: string;
        fields: Record<string, string>;
        key: string;
      };

      // POST to S3 multipart (presigned-post pattern used everywhere in the app).
      const formData = new FormData();
      for (const [name, value] of Object.entries(fields)) formData.append(name, value);
      formData.append("file", file);
      const uploadRes = await fetch(url, { method: "POST", body: formData });
      if (!uploadRes.ok) throw new Error("Upload to storage failed");

      // Register the file in the target drive.
      const registerRes = await fetch("/api/drive/files", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          s3Key,
          title: file.name,
          fileName: file.name,
          contentType: file.type || "application/octet-stream",
          sizeBytes: file.size,
          scope: target.scope,
          ...(target.folderPageId ? { folderPageId: target.folderPageId } : {}),
        }),
      });
      if (!registerRes.ok) {
        const body = await registerRes.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? "Failed to register file");
      }

      onComplete();
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  return { inputRef, uploading, uploadError, handleFileChange };
}

// ── Browse scope section ───────────────────────────────────────────────────────

// ── Per-scope actions (create / rename / move / delete) ──────────────────────
//
// Each scope routes its writes to the right endpoint: My Drive → /api/notes
// (personal notes), Lab → /api/lab-documents, Project → /api/projects/:id/
// documents. Files use /api/files/:id; files & forms move via /api/drive/move.
// One factory keeps the branching in a single place, shared by the New menu and
// the row "⋯" menu.

type ScopeKind = "mine" | "lab" | "project";
// The Core drive is Lab-workspace pages nested under the Core root folder, so it
// uses the same endpoints as Lab — its rootFolderId (below) handles the nesting.
function scopeKindOf(id: string): ScopeKind {
  return id === "mine" ? "mine" : id === "lab" || id === "core" ? "lab" : "project";
}

// A folder's own id plus every descendant folder id — so "Move to…" never
// offers a folder as a destination for itself or its own subtree.
function folderAndDescendants(items: DriveItem[], folderId: string): Set<string> {
  const childMap = new Map<string, string[]>();
  for (const it of items) {
    if (it.type !== "folder") continue;
    const p = it.parentFolderId ?? "_root_";
    const list = childMap.get(p);
    if (list) list.push(it.id);
    else childMap.set(p, [it.id]);
  }
  const out = new Set([folderId]);
  const queue = [folderId];
  while (queue.length > 0) {
    const cur = queue.pop()!;
    for (const c of childMap.get(cur) ?? []) {
      if (!out.has(c)) {
        out.add(c);
        queue.push(c);
      }
    }
  }
  return out;
}

async function errorFrom(res: Response): Promise<string | undefined> {
  return (await res.json().catch(() => ({})) as { error?: string }).error;
}

type ScopeActions = {
  createDoc: () => Promise<void>;
  createFolder: () => Promise<void>;
  rename: (item: DriveItem) => Promise<void>;
  remove: (item: DriveItem) => Promise<void>;
  requestMove: (item: DriveItem) => Promise<void>;
  performMove: (item: DriveItem, destFolderId: string | null) => Promise<void>;
};

function makeScopeActions({
  scope,
  dialog,
  toast,
  revalidate,
}: {
  scope: DriveScope;
  dialog: ReturnType<typeof useDialog>;
  toast: ReturnType<typeof useToast>;
  revalidate: () => void;
}): ScopeActions {
  const kind = scopeKindOf(scope.id);
  // The DB parent that this scope's "top level" maps to — null for most drives,
  // the Core root folder for the Core drive (so items land inside the scope).
  const rootParent = scope.rootFolderId ?? null;

  async function createPage(
    pageKind: "FreeForm" | "Folder",
    title: string,
    parentPageId: string | null,
  ): Promise<string | null> {
    if (kind === "mine") {
      const fd = new FormData();
      fd.set("intent", "create");
      fd.set("title", title);
      fd.set("isFolder", pageKind === "Folder" ? "true" : "false");
      if (parentPageId) fd.set("parentPageId", parentPageId);
      const res = await fetch("/api/notes", { method: "POST", body: fd, credentials: "include" });
      if (!res.ok) return null;
      return ((await res.json()) as { id: string }).id;
    }
    const url = kind === "lab" ? "/api/lab-documents" : `/api/projects/${scope.id}/documents`;
    const res = await fetch(url, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, kind: pageKind, ...(parentPageId ? { parentPageId } : {}) }),
    });
    if (!res.ok) return null;
    return ((await res.json()) as { id: string }).id;
  }

  async function createDoc() {
    const name = await dialog.prompt({
      title: "New document",
      label: "Name",
      defaultValue: "Untitled",
      confirmLabel: "Create",
      validate: (v) => (v.trim() ? null : "Enter a name"),
    });
    if (name === null) return;
    const id = await createPage("FreeForm", name.trim(), rootParent);
    if (id) window.location.assign(`/documents/${id}`);
    else toast.error("Couldn't create the document");
  }

  async function createFolder() {
    const name = await dialog.prompt({
      title: "New folder",
      label: "Folder name",
      defaultValue: "New folder",
      confirmLabel: "Create",
      validate: (v) => (v.trim() ? null : "Enter a name"),
    });
    if (name === null) return;
    const id = await createPage("Folder", name.trim(), rootParent);
    if (id) {
      toast.success("Folder created");
      revalidate();
    } else {
      toast.error("Couldn't create the folder");
    }
  }

  async function rename(item: DriveItem) {
    const name = await dialog.prompt({
      title: "Rename",
      label: "Name",
      defaultValue: item.title,
      confirmLabel: "Save",
      validate: (v) => (v.trim() ? null : "Enter a name"),
    });
    if (name === null) return;
    const next = name.trim();
    if (next === item.title) return;

    let res: Response;
    if (item.type === "file") {
      res = await fetch(`/api/files/${item.id}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intent: "rename", title: next }),
      });
    } else if (kind === "mine") {
      const fd = new FormData();
      fd.set("intent", "update");
      fd.set("pageId", item.id);
      fd.set("title", next);
      res = await fetch("/api/notes", { method: "POST", body: fd, credentials: "include" });
    } else {
      res = await fetch(`/api/documents/${item.id}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: next }),
      });
    }
    if (res.ok) {
      toast.success("Renamed");
      revalidate();
    } else {
      toast.error((await errorFrom(res)) ?? "Couldn't rename");
    }
  }

  async function remove(item: DriveItem) {
    const confirmed = await dialog.confirm({
      title: `Delete "${item.title || "Untitled"}"?`,
      description:
        item.type === "folder"
          ? "The folder must be empty first."
          : "It will be archived and removed from your Drive.",
      tone: "destructive",
      confirmLabel: "Delete",
    });
    if (!confirmed) return;

    let res: Response;
    if (item.type === "file") {
      res = await fetch(`/api/files/${item.id}`, { method: "DELETE", credentials: "include" });
    } else if (kind === "mine") {
      const fd = new FormData();
      fd.set("intent", "archive");
      fd.set("pageId", item.id);
      res = await fetch("/api/notes", { method: "POST", body: fd, credentials: "include" });
    } else {
      res = await fetch(`/api/documents/${item.id}`, { method: "DELETE", credentials: "include" });
    }
    if (res.ok) {
      toast.success("Deleted");
      revalidate();
    } else {
      toast.error((await errorFrom(res)) ?? "Couldn't delete");
    }
  }

  async function performMove(item: DriveItem, destFolderId: string | null) {
    // The scope's top level maps to rootParent (the Core folder for the Core
    // drive; null elsewhere), so "move to top" keeps items inside the scope.
    const target = destFolderId ?? rootParent;
    let res: Response;
    if (item.type === "doc" || item.type === "folder") {
      if (kind === "mine") {
        const fd = new FormData();
        fd.set("intent", "update");
        fd.set("pageId", item.id);
        fd.set("parentPageId", target ?? "");
        res = await fetch("/api/notes", { method: "POST", body: fd, credentials: "include" });
      } else {
        res = await fetch(`/api/pages/${item.id}/move`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ parentPageId: target }),
        });
      }
    } else {
      res = await fetch("/api/drive/move", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemType: item.type, itemId: item.id, destFolderPageId: target }),
      });
    }
    if (res.ok) toast.success("Moved");
    else toast.error((await errorFrom(res)) ?? "Couldn't move");
    revalidate();
  }

  async function requestMove(item: DriveItem) {
    const banned =
      item.type === "folder"
        ? folderAndDescendants(scope.items, item.id)
        : new Set([item.id]);
    const currentParent = item.parentFolderId ?? null;
    const options = [
      ...(currentParent !== null ? [{ value: "__root__", label: "Top level" }] : []),
      ...scope.items
        .filter((it) => it.type === "folder" && !banned.has(it.id) && it.id !== currentParent)
        .map((f) => ({ value: f.id, label: f.title || "Untitled folder" })),
    ];
    if (options.length === 0) {
      toast.error("There's nowhere else to move this");
      return;
    }
    const dest = await dialog.choice({
      title: `Move "${item.title || "Untitled"}"`,
      options,
    });
    if (dest === null) return;
    await performMove(item, dest === "__root__" ? null : dest);
  }

  return { createDoc, createFolder, rename, remove, requestMove, performMove };
}

// One collapsible scope section in the Browse view — a "drive". Each carries its
// own New ▾ menu (creating into that scope) and its tree; row "⋯" menus and
// drag-drop both route through the scope's action factory.
function ScopeSection({
  scope,
  typeFilter,
  defaultOpen,
  extraNewItems,
}: {
  scope: DriveScope;
  typeFilter: DriveTypeFilter;
  defaultOpen: boolean;
  /** Lab-only extra New-menu items (form, agreement, template, upload). */
  extraNewItems?: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const dialog = useDialog();
  const toast = useToast();
  const revalidator = useRevalidator();
  const isMine = scope.id === "mine";
  const isLab = scope.id === "lab";
  const isCore = scope.id === "core";
  const isProject = !isMine && !isLab && !isCore;

  const actions = useMemo(
    () => makeScopeActions({ scope, dialog, toast, revalidate: () => revalidator.revalidate() }),
    [scope, dialog, toast, revalidator],
  );

  const rowActions: RowActions = useMemo(
    () => ({
      onRename: actions.rename,
      onRequestMove: actions.requestMove,
      onDelete: actions.remove,
    }),
    [actions],
  );

  const onMove = useCallback(
    (args: DriveTreeMoveArgs) => {
      void actions.performMove(args.item, args.destFolderId);
    },
    [actions],
  );

  // Per-scope upload. Every drive holds files: My Drive (private/Member), Lab,
  // Core (uploaded into the Core folder so it inherits Core-only access), and
  // each project. rootFolderId is null except for Core (its folder id).
  const uploadTarget: UploadTarget = isMine
    ? { scope: { kind: "Member" } }
    : isProject
      ? { scope: { kind: "Project", projectId: scope.id } }
      : { scope: { kind: "Lab" }, folderPageId: scope.rootFolderId ?? null };
  const { inputRef, uploading, uploadError, handleFileChange } = useDriveFileUpload(
    uploadTarget,
    () => revalidator.revalidate(),
  );

  // When type filter is active, count the matching items for the badge.
  const filteredCount =
    typeFilter !== "all"
      ? scope.items.filter((it) => it.type === typeFilter).length
      : scope.items.length;

  // Items shown in the tree. A type filter narrows the *leaves* to that type but
  // always keeps folders — the folder tree is the navigation skeleton, so you
  // can still browse into where the matching items live.
  const treeItems =
    typeFilter === "all"
      ? scope.items
      : scope.items.filter((it) => it.type === "folder" || it.type === typeFilter);

  const label = isMine ? "My Drive" : isLab ? "Lab" : scope.label;

  return (
    <section
      className="bg-card border border-border rounded-lg overflow-hidden"
      data-testid={`drive-scope-${scope.id}`}
    >
      {/* Scope header: collapse toggle on the left, scope-scoped New ▾ on the right */}
      <div className="flex items-center gap-2 px-3 py-2.5">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-2 min-w-0 flex-1 text-left rounded-md px-1 py-0.5 hover:bg-muted/40 transition-colors"
        >
          <ChevronDown
            className={`w-3.5 h-3.5 text-muted-foreground shrink-0 transition-transform ${open ? "" : "-rotate-90"}`}
          />
          {isMine ? (
            <User className="w-4 h-4 text-muted-foreground shrink-0" />
          ) : isCore ? (
            <Shield className="w-4 h-4 text-accent-coral/80 shrink-0" />
          ) : isLab ? (
            <Users className="w-4 h-4 text-muted-foreground shrink-0" />
          ) : scope.iconEmoji ? (
            <span className="text-sm leading-none">{scope.iconEmoji}</span>
          ) : (
            <FolderIcon className="w-4 h-4 text-muted-foreground shrink-0" />
          )}
          <span className="font-semibold text-foreground text-sm truncate">{label}</span>
          {isCore && (
            <span className="text-[10px] uppercase tracking-wide text-accent-coral/70 shrink-0">
              Core only
            </span>
          )}
          {isProject && (
            <span className="text-[10px] uppercase tracking-wide text-accent-coral/70 shrink-0">
              Project
            </span>
          )}
          {!open && filteredCount > 0 && (
            <span className="text-[11px] text-muted-foreground shrink-0">({filteredCount})</span>
          )}
        </button>

        <Menu
          align="right"
          ariaLabel={`New in ${label}`}
          trigger={
            <button
              type="button"
              data-testid={`drive-new-menu-${scope.id}`}
              className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-medium text-foreground hover:bg-muted/60 transition-colors shrink-0"
            >
              <Plus className="w-3.5 h-3.5" /> New
              <ChevronDown className="w-3 h-3 opacity-70" />
            </button>
          }
        >
          <Menu.Item icon={<FileText className="w-3.5 h-3.5" />} onSelect={() => void actions.createDoc()}>
            <span data-testid={`drive-new-doc-${scope.id}`}>New document</span>
          </Menu.Item>
          <Menu.Item icon={<FolderOpen className="w-3.5 h-3.5" />} onSelect={() => void actions.createFolder()}>
            <span data-testid={`drive-new-folder-${scope.id}`}>New folder</span>
          </Menu.Item>
          {extraNewItems}
          <Menu.Item
            icon={<Upload className="w-3.5 h-3.5" />}
            disabled={uploading}
            onSelect={() => inputRef.current?.click()}
          >
            <span data-testid={`drive-new-upload-${scope.id}`}>
              {uploading ? "Uploading…" : "Upload file"}
            </span>
          </Menu.Item>
        </Menu>
      </div>

      {/* Hidden file input for this drive's Upload item + inline upload error */}
      <input
        ref={inputRef}
        type="file"
        className="sr-only"
        aria-hidden="true"
        tabIndex={-1}
        onChange={handleFileChange}
      />
      {uploadError && <p className="text-sm text-red-600 px-3 pb-2">{uploadError}</p>}

      {open && (
        <div className="border-t border-border px-2 pb-2">
          <DriveTree scopeId={scope.id} items={treeItems} onMove={onMove} actions={rowActions} />
        </div>
      )}
    </section>
  );
}

// ── Browse view (the only main view) ──────────────────────────────────────────

function BrowseView({
  driveScopes,
  canViewForms,
  canManageAgreements,
  typeFilter,
  onTypeFilterChange,
}: {
  driveScopes: DriveScope[];
  canViewForms: boolean;
  canManageAgreements: boolean;
  typeFilter: DriveTypeFilter;
  onTypeFilterChange: (f: DriveTypeFilter) => void;
}) {
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false);

  // Visible filter chips: always show All/Documents/Files; role-gate Forms and
  // Agreements (Core-only).
  const caps = { canViewForms, canManageAgreements };
  const visibleFilters = TYPE_FILTERS.filter(
    (f) => !f.requiresCap || caps[f.requiresCap],
  );

  // Create an agreement from the Lab New menu. The admin create action redirects
  // to the agreement detail route; we follow it and rewrite the admin path to
  // the Drive-namespaced one.
  async function createAgreement() {
    const formData = new FormData();
    formData.set("intent", "create");
    formData.set("name", "New Agreement");
    formData.set("kind", "General");
    formData.set("gateScope", "None");
    formData.set("audience", "Manual");
    formData.set("cadence", "Once");
    const res = await fetch("/admin/agreements", {
      method: "POST",
      body: formData,
      credentials: "include",
    });
    if (res.ok || res.redirected) {
      const driveUrl = res.url.replace(
        /\/admin\/agreements\/([^/]+)$/,
        "/documents/agreement/$1",
      );
      window.location.assign(driveUrl);
    }
  }

  // Lab-only New-menu extras (form, agreement, template), rendered inside the Lab
  // scope's New ▾. Upload is handled per-scope by ScopeSection (every drive), so
  // it's not here. The template picker modal lives in BrowseView (below).
  const labExtraNewItems = (
    <>
      {canViewForms && (
        <Menu.Item
          icon={<ClipboardList className="w-3.5 h-3.5" />}
          onSelect={() => window.location.assign("/forms")}
        >
          <span data-testid="drive-new-form">New form</span>
        </Menu.Item>
      )}
      {canManageAgreements && (
        <Menu.Item
          icon={<FileSignature className="w-3.5 h-3.5" />}
          onSelect={() => void createAgreement()}
        >
          <span data-testid="drive-new-agreement">New agreement</span>
        </Menu.Item>
      )}
      <Menu.Separator />
      <Menu.Item
        icon={<LayoutTemplate className="w-3.5 h-3.5" />}
        onSelect={() => setTemplatePickerOpen(true)}
      >
        <span data-testid="drive-new-template">From template…</span>
      </Menu.Item>
    </>
  );

  // Empty state: when a type filter is on and no scope has matching items.
  const hasAnyMatch =
    typeFilter === "all" ||
    driveScopes.some((s) => s.items.some((it) => it.type === typeFilter));

  const chipBase =
    "inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium transition-colors border";
  const chipActive = "bg-accent-coral/10 border-accent-coral/40 text-accent-coral";
  const chipInactive =
    "bg-transparent border-transparent text-muted-foreground hover:text-foreground hover:border-border";

  return (
    <div className="flex flex-col gap-4" data-testid="drive-browse">
      {/* Type filter chip row */}
      <div className="flex items-center gap-1.5 flex-wrap" role="group" aria-label="Filter by type">
        {visibleFilters.map((f) => (
          <button
            key={f.value}
            type="button"
            aria-pressed={typeFilter === f.value}
            onClick={() => onTypeFilterChange(f.value)}
            data-testid={`drive-filter-${f.value}`}
            className={`${chipBase} ${typeFilter === f.value ? chipActive : chipInactive}`}
          >
            {f.icon}
            {f.label}
          </button>
        ))}
      </div>

      {/* Template picker modal (Lab New → From template…) */}
      <TemplatePicker
        open={templatePickerOpen}
        onClose={() => setTemplatePickerOpen(false)}
      />

      {/* Scope sections (named drives) */}
      {driveScopes.length === 0 ? (
        <div className="rounded-lg border border-border bg-card p-6 text-center">
          <HardDrive className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
          <p className="text-sm font-medium text-foreground">Your Drive is empty</p>
          <p className="text-xs text-muted-foreground mt-1">
            Create a document or folder to get started.
          </p>
        </div>
      ) : (
        <>
          {driveScopes.map((scope) => (
            <ScopeSection
              key={scope.id}
              scope={scope}
              typeFilter={typeFilter}
              defaultOpen={scope.id === "mine" || scope.id === "lab" || scope.id === "core"}
              extraNewItems={scope.id === "lab" ? labExtraNewItems : undefined}
            />
          ))}
          {!hasAnyMatch && (
            <p className="text-sm text-muted-foreground italic px-1">
              No{" "}
              {typeFilter === "doc"
                ? "documents"
                : typeFilter === "file"
                ? "files"
                : typeFilter === "form"
                ? "forms"
                : "agreements"}{" "}
              in any of your drives.
            </p>
          )}
        </>
      )}
    </div>
  );
}

// ── Hub shell ─────────────────────────────────────────────────────────────────

export default function DriveHub() {
  const { driveScopes, canViewForms, canManageAgreements } = useLoaderData() as LoaderData;
  const [searchParams, setSearchParams] = useSearchParams();

  // Type filter comes from ?type= (default "all").
  const rawType = searchParams.get("type") as DriveTypeFilter | null;
  const typeFilter: DriveTypeFilter =
    rawType === "doc" || rawType === "file" || rawType === "form" || rawType === "agreement"
      ? rawType
      : "all";

  function setTypeFilter(f: DriveTypeFilter) {
    setSearchParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        if (f === "all") p.delete("type");
        else p.set("type", f);
        return p;
      },
      { replace: true },
    );
  }

  return (
    <div className="w-full flex flex-col gap-4 p-4">
      {/* Header row: Drive title only — Agreements and Templates shelves removed.
          Signed agreements are in Settings → Agreements.
          Page templates are accessible via the New ▾ menu. */}
      <div className="flex items-center gap-2 min-w-0">
        <HardDrive className="w-5 h-5 text-accent-coral" />
        <h1 className="text-lg font-semibold text-foreground">Drive</h1>
      </div>

      {/* Browse is the sole main view */}
      <BrowseView
        driveScopes={driveScopes}
        canViewForms={canViewForms}
        canManageAgreements={canManageAgreements}
        typeFilter={typeFilter}
        onTypeFilterChange={setTypeFilter}
      />
    </div>
  );
}
