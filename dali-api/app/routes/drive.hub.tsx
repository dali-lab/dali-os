import { redirect, Link, useLoaderData, useSearchParams, useNavigate, useRevalidator, useLocation } from "react-router";
import type { ShouldRevalidateFunctionArgs } from "react-router";
import type { Route } from "./+types/drive.hub";
import {
  FileText,
  ClipboardList,
  FileSignature,
  Paperclip,
  FolderOpen,
  Plus,
  ChevronDown,
  LayoutTemplate,
  Upload,
  Tag as TagIcon,
  X,
} from "lucide-react";
import { useState, useCallback, useEffect, useRef, useId, useMemo } from "react";
import { requireAuth, redirectPartnerToPortal } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { getUserRoles } from "~/lib/roles";
import { resolveTermFilter } from "~/lib/terms";
import { TermFilter } from "~/components/TermFilter";
import { prisma } from "~/lib/db";
import { loadDriveScopes } from "~/lib/drive-scopes.server";
import type { DriveTreeScope } from "~/lib/drive-scopes.server";
import type { DriveItem } from "~/lib/drive.server";
import { DriveBrowser } from "~/components/drive/DriveBrowser";
import type { RowActions } from "~/components/drive/DriveBrowser";
import { DestinationPicker } from "~/components/drive/DestinationPicker";
import type { PickerDrive, PickerFolder, Destination } from "~/components/drive/DestinationPicker";
import { useDialog } from "~/components/ui/dialog";
import { useToast } from "~/components/ui/toast";
import { Menu, Select } from "~/components/ui/floating";
import { Modal } from "~/components/Modal";
import { useFeatureFlag } from "~/components/FeatureFlags";
import { cn } from "~/lib/cn";
import { filterPillClass } from "~/components/ui/floating/styles";

export const meta: Route.MetaFunction = () => [{ title: "Drive · DALI OS" }];

// Drive is a single route whose meaningful context is the active scope (?scope=),
// each with different access rules — so the guide is keyed per scope rather than
// per route. Every project scope collapses to one `drive.project` guide (the
// default branch) to avoid a near-identical guide per project.
export const handle = {
  docKey: "drive.root",
  docTitle: "Drive",
  resolveDocKey: (params: URLSearchParams) => {
    const scope = params.get("scope");
    if (!scope) return { key: "drive.root", title: "Drive" };
    if (scope === "mine") return { key: "drive.mine", title: "My Drive" };
    if (scope === "lab") return { key: "drive.lab", title: "Lab-wide Drive" };
    if (scope === "core") return { key: "drive.core", title: "Core Drive" };
    if (scope === "hiring") return { key: "drive.hiring", title: "Hiring Drive" };
    return { key: "drive.project", title: "Project Drive" };
  },
};

// The loader returns the FULL drive tree (every scope's items) and ignores the
// scope/folder/type query params — those only drive client-side view state. So
// navigating between scopes and folders needs no refetch: skip revalidation
// when only the query string changed on this same route. Manual refreshes after
// a write (revalidator.revalidate(), which keeps the URL identical) and any
// non-GET submission still fall through to the default and reload the tree.
export function shouldRevalidate({
  currentUrl,
  nextUrl,
  formMethod,
  defaultShouldRevalidate,
}: ShouldRevalidateFunctionArgs) {
  if (formMethod && formMethod.toUpperCase() !== "GET") return defaultShouldRevalidate;
  if (currentUrl.pathname === nextUrl.pathname && currentUrl.search !== nextUrl.search) {
    // Scope/folder moves stay inside the tree the loader already sent, which is
    // the whole point of this gate. `?term=` is different in kind: it changes
    // which project drives exist at all, so it has to reach the loader or the
    // dropdown looks broken.
    if (currentUrl.searchParams.get("term") !== nextUrl.searchParams.get("term")) {
      return defaultShouldRevalidate;
    }
    return false;
  }
  return defaultShouldRevalidate;
}

// The unified Drive hub — the app's only document/forms browsing surface.
// Browse is the only main view. Type filter chips (All · Documents · Files ·
// Forms) filter the tree. The New ▾ menu includes real upload and from-template
// flows. Signed agreements stay in Settings → Agreements. Templates are a
// creation aid in the New menu, plus a browseable gallery at /drive/templates
// (surfaced by the Templates toolbar link when the `templates` flag is on).
// A tag chip as the Drive hands it to the client.
export type DocTagOut = { id: string; label: string; slug: string; color: string | null };

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  if (auth.user.type === "applicant") return redirect("/portal");
  const partnerRedirect = await redirectPartnerToPortal(auth);
  if (partnerRedirect) return partnerRedirect;

  const roles = await getUserRoles(auth.user.sub, request);
  // isCore is the gate for agreement authoring. Passed down as canManageAgreements
  // so drive.server.ts doesn't re-derive it (matches the canViewForms pattern).
  const userCanViewForms = roles.canViewForms;
  const userCanManageAgreements = roles.isCore;
  // Hiring-drive gate — matches the "hiring" dynamic group (Core + domain leads
  // + cycle reviewers/interviewers) so the scope shows for exactly the people
  // the Hiring root is scoped to.
  const [hiringReviewer, termFilter] = await Promise.all([
    roles.isCore || roles.isDomainLead || roles.isInterviewer
      ? Promise.resolve(null) // already qualifies; skip the DB hit
      : prisma.cycleReviewer.findFirst({
          where: { userId: auth.user.sub },
          select: { id: true },
        }),
    resolveTermFilter(request),
  ]);
  const hasHiringAccess =
    roles.isCore || roles.isDomainLead || roles.isInterviewer || hiringReviewer !== null;

  // Load only the project list needed to build Drive scopes — same access
  // filter as documents.hub: Core sees all projects; others see only projects
  // they're staffed on, scoped to the current term (matching the default
  // ?term= behavior when docsLoader is called with a /drive URL).
  // `?term=` scopes which project drives appear, exactly as it scopes the
  // projects hub; "All terms" drops the gate so older project drives stay
  // reachable. Defaults to the current term, which is what this used to
  // hard-code.
  const termId = termFilter.isAll ? null : termFilter.termId;
  const rawProjects = await prisma.project.findMany({
    where: {
      ...(termId ? { projectTerms: { some: { termId } } } : {}),
      ...(roles.isCore ? {} : { assignments: { some: { userId: auth.user.sub } } }),
    },
    orderBy: [{ status: "asc" }, { name: "asc" }],
    select: { id: true, name: true, iconEmoji: true },
  });
  const projectWorkspaces = rawProjects.map((p) => ({
    key: p.id,
    label: p.name,
    kind: "project" as const,
    projectIconEmoji: p.iconEmoji,
  }));

  const driveScopes = await loadDriveScopes({
    userSub: auth.user.sub,
    projectWorkspaces,
    canViewForms: userCanViewForms,
    canManageAgreements: userCanManageAgreements,
    isCore: roles.isCore,
    hasHiringAccess,
    request,
  });

  // Tags come from the join tables keyed by the ids the scopes actually
  // resolved to, rather than being selected into every page/file query in
  // drive.server. Two bounded queries instead of a join on each of the six
  // scope loaders, and drive.server keeps knowing nothing about tags.
  const pageIds: string[] = [];
  const fileIds: string[] = [];
  for (const scope of driveScopes) {
    for (const item of scope.items) {
      if (item.type === "doc" || item.type === "folder") pageIds.push(item.id);
      else if (item.type === "file") fileIds.push(item.id);
    }
  }
  const [allTags, pageTags, fileTags] = await Promise.all([
    // Every live tag, not just the ones already on something visible here.
    // Restricting it to what's in view hides the control completely until
    // somebody has tagged a document — which reads as "the filter is missing"
    // rather than "nothing is tagged yet". Matches the old documents hub.
    prisma.docTag.findMany({
      where: { archivedAt: null },
      orderBy: { label: "asc" },
      select: { id: true, label: true, slug: true, color: true },
    }),
    pageIds.length
      ? prisma.pageTag.findMany({
          where: { pageId: { in: pageIds }, tag: { archivedAt: null } },
          select: { pageId: true, tag: { select: { id: true } } },
        })
      : Promise.resolve([]),
    fileIds.length
      ? prisma.projectFileTag.findMany({
          where: { fileId: { in: fileIds }, tag: { archivedAt: null } },
          select: { fileId: true, tag: { select: { id: true } } },
        })
      : Promise.resolve([]),
  ]);

  const itemTagIds: Record<string, string[]> = {};
  for (const { pageId, tag } of pageTags) (itemTagIds[pageId] ??= []).push(tag.id);
  for (const { fileId, tag } of fileTags) (itemTagIds[fileId] ??= []).push(tag.id);

  return {
    driveScopes,
    allTags,
    itemTagIds,
    terms: termFilter.terms,
    selectedTerm: termFilter.selected,
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
// Where a "From template" create lands. Templates themselves are Lab-wide (the
// shared set), but the new doc is created into whichever scope you're browsing.
export type TemplateTarget = {
  targetWorkspaceType: "Lab" | "Project";
  targetWorkspaceId?: string;
  targetParentPageId?: string;
};

function TemplatePicker({
  open,
  onClose,
  target,
}: {
  open: boolean;
  onClose: () => void;
  target: TemplateTarget;
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
        body: JSON.stringify({ templatePageId: templateId, ...target }),
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

  // Upload a single file: presign → PUT S3 → register in the target drive.
  async function uploadOne(file: File): Promise<void> {
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

    const formData = new FormData();
    for (const [name, value] of Object.entries(fields)) formData.append(name, value);
    formData.append("file", file);
    const uploadRes = await fetch(url, { method: "POST", body: formData });
    if (!uploadRes.ok) throw new Error("Upload to storage failed");

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
  }

  // Upload one or many files (drag-drop can drop several). Sequential so an
  // early failure surfaces without racing the rest.
  async function uploadFiles(files: File[]): Promise<void> {
    if (files.length === 0) return;
    setUploading(true);
    setUploadError(null);
    try {
      for (const file of files) await uploadOne(file);
      onComplete();
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files ? Array.from(e.target.files) : [];
    // Reset the input so the same file can be re-selected after an error.
    e.target.value = "";
    await uploadFiles(files);
  }

  return { inputRef, uploading, uploadError, handleFileChange, uploadFiles };
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
  return id === "mine" ? "mine" : id === "lab" || id === "core" || id === "hiring" ? "lab" : "project";
}

// Who can see items in a scope — shown in the cross-drive move confirmation so
// the mover knows a move re-scopes visibility.
function scopeAudience(scopeId: string): string {
  if (scopeId === "core") return "Core only";
  if (scopeId === "hiring") return "the hiring team";
  if (scopeId === "lab") return "everyone in the lab";
  return "the project team";
}

// A scope's destination workspace + drive-root parent for a cross-drive move.
// Lab/Core/Hiring are all Lab-workspace pages (Core/Hiring nest under their
// scoped root folder); a project scope is its own Project workspace.
function scopeDest(scope: DriveTreeScope): {
  workspaceType: "Lab" | "Project";
  workspaceId: string | null;
  root: string | null;
} {
  return scopeKindOf(scope.id) === "project"
    ? { workspaceType: "Project", workspaceId: scope.id, root: scope.rootFolderId ?? null }
    : { workspaceType: "Lab", workspaceId: null, root: scope.rootFolderId ?? null };
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
  /** Delete request without the confirm/toast — used by bulk delete. */
  deleteItem: (item: DriveItem) => Promise<Response>;
  performMove: (item: DriveItem, destFolderId: string | null) => Promise<void>;
};

function makeScopeActions({
  scope,
  currentFolderId,
  dialog,
  toast,
  revalidate,
}: {
  scope: DriveScope;
  /** Folder the browser is currently in within this scope — new items land
   *  here. null = the scope's top level. */
  currentFolderId: string | null;
  dialog: ReturnType<typeof useDialog>;
  toast: ReturnType<typeof useToast>;
  revalidate: () => void;
}): ScopeActions {
  const kind = scopeKindOf(scope.id);
  // The DB parent that this scope's "top level" maps to — null for most drives,
  // the Core root folder for the Core drive (so items land inside the scope).
  const rootParent = scope.rootFolderId ?? null;
  // New items are created in the current folder, falling back to the scope's
  // top level (rootParent) when browsing at the scope root.
  const createParent = currentFolderId ?? rootParent;

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
    const id = await createPage("FreeForm", name.trim(), createParent);
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
    const id = await createPage("Folder", name.trim(), createParent);
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
    if (item.type === "form") {
      const fd = new FormData();
      fd.set("intent", "rename-form");
      fd.set("id", item.id);
      fd.set("name", next);
      res = await fetch("/api/forms", { method: "POST", body: fd, credentials: "include" });
    } else if (item.type === "file") {
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

  // The raw delete request for an item, routed to the right endpoint. No
  // confirm/toast — the single-item `remove` and the hub's bulk delete wrap it.
  async function deleteItem(item: DriveItem): Promise<Response> {
    if (item.type === "form") {
      const fd = new FormData();
      fd.set("intent", "delete-form");
      fd.set("id", item.id);
      return fetch("/api/forms", { method: "POST", body: fd, credentials: "include" });
    }
    if (item.type === "file") {
      return fetch(`/api/files/${item.id}`, { method: "DELETE", credentials: "include" });
    }
    if (kind === "mine") {
      const fd = new FormData();
      fd.set("intent", "archive");
      fd.set("pageId", item.id);
      return fetch("/api/notes", { method: "POST", body: fd, credentials: "include" });
    }
    return fetch(`/api/documents/${item.id}`, { method: "DELETE", credentials: "include" });
  }

  async function remove(item: DriveItem) {
    const confirmed = await dialog.confirm({
      title: `Delete "${item.title || "Untitled"}"?`,
      description:
        item.type === "folder"
          ? "The folder must be empty first."
          : item.type === "form"
            ? "This permanently deletes the form and its responses. Forms still in use can't be deleted."
            : "It will be archived and removed from your Drive.",
      tone: "destructive",
      confirmLabel: "Delete",
    });
    if (!confirmed) return;

    const res = await deleteItem(item);
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

  return { createDoc, createFolder, rename, remove, deleteItem, performMove };
}

// ── New menu (contextual to the current location) ────────────────────────────

// The New ▾ button in the header. Creates into the current scope + folder via
// the scope's action factory; Lab adds form/agreement/template extras. Hidden
// at the Drive root (you pick a drive first).
function NewMenu({
  scope,
  actions,
  canViewForms,
  canManageAgreements,
  onUploadClick,
  uploading,
  onTemplate,
  currentFolderId,
}: {
  scope: DriveScope;
  actions: ScopeActions;
  canViewForms: boolean;
  canManageAgreements: boolean;
  onUploadClick: () => void;
  uploading: boolean;
  onTemplate: () => void;
  currentFolderId: string | null;
}) {
  const isLab = scope.id === "lab";
  const label = scope.id === "mine" ? "My Drive" : isLab ? "Lab" : scope.label;
  const dialog = useDialog();
  const toast = useToast();

  // Create a form into the current Drive folder, then navigate to its editor.
  // Prompts for a name first (like New document/folder).
  async function createForm() {
    const name = await dialog.prompt({
      title: "New form",
      label: "Name",
      defaultValue: "Untitled form",
      confirmLabel: "Create",
      validate: (v) => (v.trim() ? null : "Enter a name"),
    });
    if (name === null) return;
    const folderPageId = currentFolderId ?? scope.rootFolderId ?? null;
    const formData = new FormData();
    formData.set("intent", "create-form");
    formData.set("name", name.trim());
    if (folderPageId) formData.set("folderPageId", folderPageId);
    const res = await fetch("/api/forms", { method: "POST", body: formData, credentials: "include" });
    const json = await res.json() as { ok?: boolean; formId?: string };
    if (json.ok && json.formId) {
      window.location.assign(`/forms/edit/${json.formId}`);
    } else {
      toast.error("Couldn't create the form");
    }
  }

  // Create an agreement from the Core New menu. Prompts for a name (like New
  // document), then follows the admin create action's redirect, rewriting the
  // admin path to the Drive-namespaced one. The create action files it into
  // Core ▸ Agreements ▸ {kind} so its breadcrumb resolves.
  async function createAgreement() {
    const name = await dialog.prompt({
      title: "New agreement",
      label: "Name",
      defaultValue: "Untitled agreement",
      confirmLabel: "Create",
      validate: (v) => (v.trim() ? null : "Enter a name"),
    });
    if (name === null) return;
    const formData = new FormData();
    formData.set("intent", "create");
    formData.set("name", name.trim());
    formData.set("kind", "General");
    formData.set("gateScope", "None");
    formData.set("audience", "Manual");
    formData.set("cadence", "Once");
    const res = await fetch("/admin/agreements", { method: "POST", body: formData, credentials: "include" });
    if (res.ok || res.redirected) {
      const driveUrl = res.url.replace(/\/admin\/agreements\/([^/]+)$/, "/documents/agreement/$1");
      window.location.assign(driveUrl);
    }
  }

  return (
    <Menu
      align="right"
      ariaLabel={`New in ${label}`}
      trigger={
        <button
          type="button"
          data-testid={`drive-new-menu-${scope.id}`}
          className="inline-flex items-center gap-1 rounded-md bg-accent-coral px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-coral/90 transition-colors shrink-0"
        >
          <Plus className="w-4 h-4" /> New
          <ChevronDown className="w-3.5 h-3.5 opacity-80" />
        </button>
      }
    >
      <Menu.Item icon={<FileText className="w-3.5 h-3.5" />} onSelect={() => void actions.createDoc()}>
        <span data-testid={`drive-new-doc-${scope.id}`}>New document</span>
      </Menu.Item>
      <Menu.Item icon={<FolderOpen className="w-3.5 h-3.5" />} onSelect={() => void actions.createFolder()}>
        <span data-testid={`drive-new-folder-${scope.id}`}>New folder</span>
      </Menu.Item>
      {canViewForms && (
        <Menu.Item icon={<ClipboardList className="w-3.5 h-3.5" />} onSelect={() => void createForm()}>
          <span data-testid="drive-new-form">New form</span>
        </Menu.Item>
      )}
      {scope.id === "core" && canManageAgreements && (
        <Menu.Item icon={<FileSignature className="w-3.5 h-3.5" />} onSelect={() => void createAgreement()}>
          <span data-testid="drive-new-agreement">New agreement</span>
        </Menu.Item>
      )}
      {scope.id !== "mine" && (
        <>
          <Menu.Separator />
          <Menu.Item icon={<LayoutTemplate className="w-3.5 h-3.5" />} onSelect={onTemplate}>
            <span data-testid="drive-new-template">From template…</span>
          </Menu.Item>
        </>
      )}
      <Menu.Separator />
      <Menu.Item icon={<Upload className="w-3.5 h-3.5" />} disabled={uploading} onSelect={onUploadClick}>
        <span data-testid={`drive-new-upload-${scope.id}`}>{uploading ? "Uploading…" : "Upload file"}</span>
      </Menu.Item>
    </Menu>
  );
}

// ── Hub shell ─────────────────────────────────────────────────────────────────

export default function DriveHub() {
  const {
    driveScopes,
    allTags,
    itemTagIds,
    terms,
    selectedTerm,
    canViewForms,
    canManageAgreements,
  } = useLoaderData() as LoaderData;
  const os = useFeatureFlag("os-redesign");
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const dialog = useDialog();
  const toast = useToast();
  const revalidator = useRevalidator();
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false);
  const templatesEnabled = useFeatureFlag("templates");
  // Search is a client-side filter over already-loaded items, so it lives in
  // local state — keeping it out of the URL avoids a loader revalidation on
  // every keystroke. Scope/folder/type stay in the URL (linkable, back/forward).
  const [search, setSearch] = useState("");

  // "Move to…" destination picker. Opened imperatively by pickMoveDestination,
  // which returns a promise the bulk/single move flows await; the resolver is
  // called on confirm (with the chosen destination) or cancel (with null).
  const [movePicker, setMovePicker] = useState<null | {
    heading: string;
    drives: PickerDrive[];
    folders: PickerFolder[];
    disabledFolderIds?: Set<string>;
    disabledDest?: Destination | null;
    initial?: Destination;
  }>(null);
  const movePickerResolve = useRef<((d: Destination | null) => void) | null>(null);
  const resolveMovePicker = useCallback((dest: Destination | null) => {
    setMovePicker(null);
    const resolve = movePickerResolve.current;
    movePickerResolve.current = null;
    resolve?.(dest);
  }, []);

  // Location + view state from the URL. No scope/folder = Drive root — except
  // when this same hub is embedded at /hiring/library, where it opens straight
  // into the Hiring drive so the hiring team lands on their artifacts.
  const location = useLocation();
  const isHiringLibrary = location.pathname.startsWith("/hiring/library");
  const currentScopeId = searchParams.get("scope") ?? (isHiringLibrary ? "hiring" : null);
  const currentFolderId = searchParams.get("folder");
  // In the URL like ?type= and ?term=, so "everything tagged onboarding" is a
  // link someone can send, and the back button steps through filters.
  const selectedTagIds = useMemo(
    () => new Set(searchParams.getAll("tag").filter(Boolean)),
    [searchParams],
  );
  const rawType = searchParams.get("type") as DriveTypeFilter | null;
  const typeFilter: DriveTypeFilter =
    rawType === "doc" || rawType === "file" || rawType === "form" || rawType === "agreement" ? rawType : "all";

  const currentScope = useMemo(
    () => driveScopes.find((s) => s.id === currentScopeId) ?? null,
    [driveScopes, currentScopeId],
  );
  // A scope id in the URL that no longer resolves (e.g. left the project) →
  // treat as root rather than a blank screen.
  const effectiveScopeId = currentScope ? currentScope.id : null;

  function patchParams(mutate: (p: URLSearchParams) => void, opts?: { replace?: boolean }) {
    setSearchParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        mutate(p);
        return p;
      },
      { replace: opts?.replace ?? true },
    );
  }

  const onNavigate = useCallback(
    (scopeId: string | null, folderId: string | null) => {
      // Clicking into the tree leaves search mode.
      setSearch("");
      patchParams((p) => {
        if (scopeId) p.set("scope", scopeId);
        else p.delete("scope");
        if (folderId) p.set("folder", folderId);
        else p.delete("folder");
      });
    },
    [setSearchParams],
  );

  const onSearchChange = useCallback((q: string) => setSearch(q), []);

  function setTypeFilter(f: DriveTypeFilter) {
    patchParams((p) => {
      if (f === "all") p.delete("type");
      else p.set("type", f);
    });
  }

  // Per-scope action factory map. Creates land in the current folder for the
  // scope being browsed; other scopes (search-result rows) only rename/move/
  // delete, so their create-folder target doesn't matter.
  const scopeActionsMap = useMemo(() => {
    const map = new Map<string, ScopeActions>();
    for (const scope of driveScopes) {
      map.set(
        scope.id,
        makeScopeActions({
          scope,
          currentFolderId: scope.id === effectiveScopeId ? currentFolderId : null,
          dialog,
          toast,
          revalidate: () => revalidator.revalidate(),
        }),
      );
    }
    return map;
  }, [driveScopes, effectiveScopeId, currentFolderId, dialog, toast, revalidator]);

  const onMove = useCallback(
    (scopeId: string, item: DriveItem, destFolderId: string | null) => {
      void scopeActionsMap.get(scopeId)?.performMove(item, destFolderId);
    },
    [scopeActionsMap],
  );

  // ── Cross-drive move: relocate an item to another drive (Lab/Core/Hiring/a
  // project), optionally into one of its folders. The page-move endpoint
  // re-scopes visibility automatically (e.g. into Core → Restricted), so we warn
  // first. Managed types (agreement/rubric/emailTemplate) are filed
  // automatically and excluded. Files/forms use folderPageId and stay within the
  // Lab-workspace drives; docs/folders can also cross into projects.
  const NON_MOVABLE = new Set<DriveItem["type"]>(["agreement", "rubric", "emailTemplate"]);
  const moveDestinationsFor = useCallback(
    (item: DriveItem): DriveTreeScope[] =>
      driveScopes.filter((s) => {
        if (s.id === "mine" || NON_MOVABLE.has(item.type)) return false;
        const labWorkspace = scopeKindOf(s.id) !== "project";
        // Files/forms move by folderPageId (no workspace change), so restrict
        // them to the Lab-workspace drives. Docs/folders can go anywhere.
        return item.type === "doc" || item.type === "folder" ? true : labWorkspace;
      }),
    [driveScopes],
  );

  const moveItemToScope = useCallback(
    async (
      item: DriveItem,
      sourceScopeId: string,
      destScopeId: string,
      destFolderPageId: string | null,
      opts?: { skipConfirm?: boolean },
    ) => {
      const destScope = driveScopes.find((s) => s.id === destScopeId);
      if (!destScope) return;
      const d = scopeDest(destScope);
      const src = driveScopes.find((s) => s.id === sourceScopeId);
      const srcWs = src ? scopeDest(src) : { workspaceType: "Lab" as const, workspaceId: null, root: null };
      const parent = destFolderPageId ?? d.root; // drive top = scoped root (Core/Hiring) or null (Lab/project)

      // No-op if it's already there.
      if (destScopeId === sourceScopeId && (parent ?? null) === (item.parentFolderId ?? null)) return;

      if (!opts?.skipConfirm && destScopeId !== sourceScopeId) {
        const ok = await dialog.confirm({
          title: `Move to ${destScope.label}?`,
          description: `"${item.title || "Untitled"}" will move to ${destScope.label} and become visible to ${scopeAudience(destScopeId)}.`,
          confirmLabel: "Move",
        });
        if (!ok) return;
      }

      let res: Response;
      if (item.type === "doc" || item.type === "folder") {
        const crossWs = d.workspaceType !== srcWs.workspaceType || d.workspaceId !== srcWs.workspaceId;
        res = await fetch(`/api/pages/${item.id}/move`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            parentPageId: parent,
            ...(crossWs ? { workspaceType: d.workspaceType, workspaceId: d.workspaceId } : {}),
          }),
        });
      } else {
        res = await fetch("/api/drive/move", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ itemType: item.type, itemId: item.id, destFolderPageId: parent }),
        });
      }
      if (res.ok) toast.success("Moved");
      else toast.error((await errorFrom(res)) ?? "Couldn't move");
      revalidator.revalidate();
    },
    [driveScopes, dialog, toast, revalidator],
  );

  // Open the hybrid destination picker over every drive the item(s) may move to
  // and resolve with the chosen destination (or null on cancel). The scope id is
  // the picker's driveId, so we return it verbatim.
  const pickMoveDestination = useCallback(
    (item: DriveItem, sourceScopeId: string, heading: string): Promise<{ scopeId: string; folderId: string | null } | null> => {
      const scopes = moveDestinationsFor(item);
      if (scopes.length === 0) {
        toast.error("There's nowhere else to move this");
        return Promise.resolve(null);
      }
      const banned =
        item.type === "folder"
          ? folderAndDescendants(driveScopes.find((s) => s.id === sourceScopeId)?.items ?? [], item.id)
          : undefined;
      const drives: PickerDrive[] = scopes.map((s) => ({
        id: s.id,
        label: s.id === "lab" ? "Lab" : s.label,
        iconEmoji: s.iconEmoji,
      }));
      const folders: PickerFolder[] = [];
      for (const s of scopes) {
        const rootId = s.rootFolderId ?? null;
        for (const f of s.items) {
          if (f.type !== "folder") continue;
          // Normalise a scope's top-level folders (Core/Hiring nest under a root
          // folder) so parentId === null uniformly means "drive top level".
          folders.push({
            id: f.id,
            driveId: s.id,
            parentId: (f.parentFolderId ?? null) === rootId ? null : f.parentFolderId,
            title: f.title,
            iconEmoji: f.iconEmoji,
          });
        }
      }
      const sourceRoot = driveScopes.find((s) => s.id === sourceScopeId)?.rootFolderId ?? null;
      const currentFolder = (item.parentFolderId ?? null) === sourceRoot ? null : (item.parentFolderId ?? null);
      const currentDest: Destination = { driveId: sourceScopeId, folderId: currentFolder };
      return new Promise((resolve) => {
        movePickerResolve.current = resolve as (d: Destination | null) => void;
        setMovePicker({
          heading,
          drives,
          folders,
          disabledFolderIds: banned,
          disabledDest: currentDest,
          initial: currentDest,
        });
      }).then((dest) =>
        dest ? { scopeId: (dest as Destination).driveId, folderId: (dest as Destination).folderId } : null,
      );
    },
    [driveScopes, moveDestinationsFor, toast],
  );

  const requestMoveCrossDrive = useCallback(
    async (sourceScopeId: string, item: DriveItem) => {
      const dest = await pickMoveDestination(item, sourceScopeId, `Move "${item.title || "Untitled"}"`);
      if (dest) await moveItemToScope(item, sourceScopeId, dest.scopeId, dest.folderId);
    },
    [pickMoveDestination, moveItemToScope],
  );

  // Bulk move: pick a destination once, then move every selected item there
  // (confirming the visibility change a single time upfront).
  const onBulkMove = useCallback(
    async (items: DriveItem[]) => {
      const movable = items.filter((i) => !NON_MOVABLE.has(i.type));
      if (movable.length === 0 || !effectiveScopeId) return;
      const dest = await pickMoveDestination(
        movable[0],
        effectiveScopeId,
        `Move ${movable.length} item${movable.length === 1 ? "" : "s"}`,
      );
      if (!dest) return;
      if (dest.scopeId !== effectiveScopeId) {
        const destScope = driveScopes.find((s) => s.id === dest.scopeId);
        const ok = await dialog.confirm({
          title: `Move ${movable.length} item${movable.length === 1 ? "" : "s"}?`,
          description: `They'll move to ${destScope?.label ?? "the selected drive"} and become visible to ${scopeAudience(dest.scopeId)}.`,
          confirmLabel: "Move",
        });
        if (!ok) return;
      }
      for (const it of movable) {
        await moveItemToScope(it, effectiveScopeId, dest.scopeId, dest.folderId, { skipConfirm: true });
      }
    },
    [pickMoveDestination, moveItemToScope, effectiveScopeId, driveScopes, dialog],
  );

  // Cross-drive drag-and-drop: dropping an item onto a drive row (column-view
  // scope column) moves it to that drive's top level, confirming the re-scope.
  const onMoveToScope = useCallback(
    (sourceScopeId: string, destScopeId: string, item: DriveItem) => {
      if (NON_MOVABLE.has(item.type)) return;
      void moveItemToScope(item, sourceScopeId, destScopeId, null);
    },
    [moveItemToScope],
  );

  const getScopeActions = useCallback(
    (scopeId: string): RowActions => {
      const a = scopeActionsMap.get(scopeId);
      if (!a) return { onRename: () => {}, onRequestMove: () => {}, onDelete: () => {} };
      return {
        onRename: a.rename,
        onRequestMove: (item: DriveItem) => void requestMoveCrossDrive(scopeId, item),
        onDelete: a.remove,
      };
    },
    [scopeActionsMap, requestMoveCrossDrive],
  );

  const onOpenItem = useCallback(
    (item: DriveItem) => {
      navigate(item.href);
    },
    [navigate],
  );

  // Toggle the viewer's personal favorite on a page item (doc/folder).
  const onToggleFavorite = useCallback(
    async (item: DriveItem) => {
      if (item.type !== "doc" && item.type !== "folder") return;
      await fetch(`/api/pages/${item.id}/favorite`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ favorited: !item.favorited }),
      });
      revalidator.revalidate();
    },
    [revalidator],
  );

  // Bulk delete the selected items (one confirm, then delete each). Selection is
  // always within the current scope, so we route through its action factory.
  const onBulkDelete = useCallback(
    async (items: DriveItem[]) => {
      if (items.length === 0 || !effectiveScopeId) return;
      const actions = scopeActionsMap.get(effectiveScopeId);
      if (!actions) return;
      const confirmed = await dialog.confirm({
        title: `Delete ${items.length} item${items.length === 1 ? "" : "s"}?`,
        description: "Folders must be empty first.",
        tone: "destructive",
        confirmLabel: "Delete",
      });
      if (!confirmed) return;
      let fail = 0;
      for (const it of items) {
        const res = await actions.deleteItem(it);
        if (!res.ok) fail++;
      }
      revalidator.revalidate();
      if (fail) toast.error(`${fail} item${fail === 1 ? "" : "s"} couldn't be deleted`);
      else toast.success(`Deleted ${items.length}`);
    },
    [effectiveScopeId, scopeActionsMap, dialog, toast, revalidator],
  );

  // Upload for the current scope + folder. Called unconditionally (hook rule);
  // when at the Drive root the target defaults to Lab but the New menu (and thus
  // the upload item) isn't rendered there.
  const uploadTarget: UploadTarget = useMemo(() => {
    if (!currentScope) return { scope: { kind: "Lab" } };
    if (currentScope.id === "mine") return { scope: { kind: "Member" }, folderPageId: currentFolderId };
    if (currentScope.id === "lab" || currentScope.id === "core" || currentScope.id === "hiring")
      return { scope: { kind: "Lab" }, folderPageId: currentFolderId ?? currentScope.rootFolderId ?? null };
    return { scope: { kind: "Project", projectId: currentScope.id }, folderPageId: currentFolderId };
  }, [currentScope, currentFolderId]);
  const { inputRef, uploading, uploadError, handleFileChange, uploadFiles } = useDriveFileUpload(
    uploadTarget,
    () => revalidator.revalidate(),
  );

  const currentActions = effectiveScopeId ? scopeActionsMap.get(effectiveScopeId) : undefined;

  // "From template" lands in the scope currently being browsed (project → that
  // project; Lab/Core/Hiring → the Lab workspace, into the scoped root folder).
  const templateTarget: TemplateTarget = useMemo(() => {
    if (!currentScope || scopeKindOf(currentScope.id) !== "project") {
      const parent = currentFolderId ?? currentScope?.rootFolderId ?? undefined;
      return { targetWorkspaceType: "Lab", targetParentPageId: parent };
    }
    return {
      targetWorkspaceType: "Project",
      targetWorkspaceId: currentScope.id,
      targetParentPageId: currentFolderId ?? undefined,
    };
  }, [currentScope, currentFolderId]);

  const toggleTag = useCallback(
    (id: string) => {
      patchParams((p) => {
        const next = p.getAll("tag").filter((t) => t !== id);
        if (!p.getAll("tag").includes(id)) next.push(id);
        p.delete("tag");
        for (const t of next) p.append("tag", t);
      });
    },
    // patchParams is redefined each render but only closes over setSearchParams.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const clearTags = useCallback(() => {
    patchParams((p) => p.delete("tag"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Undefined when nothing is selected — DriveBrowser reads the absence of this
  // as "tag filter off" rather than taking a separate flag.
  const tagFilter = useMemo(() => {
    if (selectedTagIds.size === 0) return undefined;
    return (item: DriveItem) =>
      (itemTagIds[item.id] ?? []).some((id) => selectedTagIds.has(id));
  }, [selectedTagIds, itemTagIds]);

  const tagChips =
    allTags.length > 0 ? (
      <div className={cn("flex items-center gap-2 flex-wrap", os && "pb-1")}>
        <TagIcon className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        {allTags.map((tag) => {
          const active = selectedTagIds.has(tag.id);
          return (
            <button
              key={tag.id}
              type="button"
              onClick={() => toggleTag(tag.id)}
              aria-pressed={active}
              className={cn(
                "inline-flex items-center rounded-full border font-medium transition-colors",
                os ? "px-3.5 py-1.5 text-sm" : "px-2.5 py-0.5 text-xs",
                active
                  ? os
                    ? "border-os-accent bg-os-accent/15 text-os-accent"
                    : "border-accent-coral bg-accent-coral/10 text-accent-coral"
                  : "border-border text-muted-foreground hover:text-foreground hover:border-foreground/30",
              )}
            >
              {tag.label}
            </button>
          );
        })}
        {selectedTagIds.size > 0 && (
          <button
            type="button"
            onClick={clearTags}
            className={cn(
              "inline-flex items-center gap-1 text-muted-foreground hover:text-foreground",
              os ? "text-sm" : "text-xs",
            )}
          >
            <X className="w-3 h-3" /> Clear
          </button>
        )}
      </div>
    ) : null;

  const caps = { canViewForms, canManageAgreements };
  const visibleFilters = TYPE_FILTERS.filter((f) => !f.requiresCap || caps[f.requiresCap]);

  // Type filter as the site's Select dropdown (matches members/forms filters),
  // collapsing the old chip row into one compact control.
  const filterControl = (
    <>
      <div data-testid="drive-filter">
        <Select<DriveTypeFilter>
          value={typeFilter}
          onChange={setTypeFilter}
          ariaLabel="Filter by type"
          align="right"
          options={visibleFilters.map((f) => ({ value: f.value, label: f.label, icon: f.icon }))}
          buttonClassName={cn(filterPillClass(os), "w-full sm:w-40")}
        />
      </div>
      {/* Scopes which project drives are listed — the project drives are the
          only part of the tree that is term-bound. */}
      <div data-testid="drive-term-filter">
        <TermFilter terms={terms} selected={selectedTerm} />
      </div>
    </>
  );

  const newMenuNode =
    currentScope && currentActions ? (
      <NewMenu
        scope={currentScope}
        actions={currentActions}
        canViewForms={canViewForms}
        canManageAgreements={canManageAgreements}
        onUploadClick={() => inputRef.current?.click()}
        uploading={uploading}
        onTemplate={() => setTemplatePickerOpen(true)}
        currentFolderId={currentFolderId}
      />
    ) : null;

  // Toolbar actions: the Templates gallery link (flag-gated, shown at every
  // scope including the root) alongside the scope's New menu.
  const toolbarActions = (
    <>
      {templatesEnabled && (
        <Link
          to="/drive/templates"
          className={cn(
            "shrink-0 inline-flex items-center gap-1.5 border border-border text-sm text-foreground hover:bg-muted/40 transition-colors",
            os ? "rounded-full bg-card px-5 py-2.5" : "rounded-md px-3 py-1.5",
          )}
        >
          <LayoutTemplate className="w-3.5 h-3.5" />
          Templates
        </Link>
      )}
      {newMenuNode}
    </>
  );

  return (
    // Off-flag this keeps its own p-4. Under the design the shell already lays
    // a 64px/60px gutter on every page, so a second inset here started Drive's
    // content 16px in from where every other page's begins — visible as soon as
    // two tabs sit side by side.
    <div className={cn("w-full flex flex-col", os ? "gap-4" : "gap-3 p-4")}>
      {/* Drive used to treat its breadcrumb as the page title. That worked when
          no page had a title; under the design every hub opens with one, and a
          page that starts straight into a toolbar reads as a fragment of some
          other screen. The breadcrumb stays — it's navigation, and it carries
          the scope and folder the title can't. */}
      {os && (
        <header className="flex items-start justify-between gap-3 flex-wrap">
          <h1 className="font-heading text-4xl font-medium text-foreground">
            {isHiringLibrary ? "Library" : "Drive"}
          </h1>
        </header>
      )}
      {uploadError && <p className="text-sm text-red-600">{uploadError}</p>}

      <DriveBrowser
        scopes={driveScopes}
        currentScopeId={effectiveScopeId}
        currentFolderId={currentFolderId}
        typeFilter={typeFilter}
        search={search}
        onSearchChange={onSearchChange}
        onNavigate={onNavigate}
        onOpenItem={onOpenItem}
        onMove={onMove}
        getScopeActions={getScopeActions}
        onToggleFavorite={onToggleFavorite}
        onBulkDelete={onBulkDelete}
        onBulkMove={(items) => void onBulkMove(items)}
        onMoveToScope={onMoveToScope}
        onUploadFiles={currentScope ? uploadFiles : undefined}
        filterControl={filterControl}
        newMenu={toolbarActions}
        tagChips={tagChips}
        tagFilter={tagFilter}
      />

      {/* Hidden upload input (driven by the New menu) + template picker modal */}
      <input
        ref={inputRef}
        type="file"
        className="sr-only"
        aria-hidden="true"
        tabIndex={-1}
        onChange={handleFileChange}
      />
      <TemplatePicker
        open={templatePickerOpen}
        onClose={() => setTemplatePickerOpen(false)}
        target={templateTarget}
      />

      {movePicker && (
        <DestinationPicker
          open
          heading={movePicker.heading}
          drives={movePicker.drives}
          folders={movePicker.folders}
          disabledFolderIds={movePicker.disabledFolderIds}
          disabledDest={movePicker.disabledDest}
          initial={movePicker.initial}
          onClose={() => resolveMovePicker(null)}
          onConfirm={(dest) => resolveMovePicker(dest)}
        />
      )}
    </div>
  );
}
