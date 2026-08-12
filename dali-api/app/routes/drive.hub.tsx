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
} from "lucide-react";
import { useState, useCallback, useEffect, useRef, useId } from "react";
import { requireAuth, redirectPartnerToPortal } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { canViewForms as checkCanViewForms, getUserRoles } from "~/lib/roles";
import { loader as docsLoader } from "~/routes/documents.hub";
import { loadDriveScopes } from "~/lib/drive-scopes.server";
import type { DriveItem } from "~/lib/drive.server";
import { DriveTree } from "~/components/drive/DriveTree";
import type { DriveTreeMoveArgs } from "~/components/drive/DriveTree";
import { useDialog } from "~/components/ui/dialog";
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
// POST /api/drive/files. Reuses the same presign pattern as AssignmentWorkArea
// and ProjectImageBanner. Returns the file input ref so the Menu item can
// trigger a click on it.
function useLabFileUpload(onComplete: () => void) {
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
      const key = `lab-files/${crypto.randomUUID()}-${file.name}`;
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

      // Register the file in the lab drive.
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
          scope: { kind: "Lab" },
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

// One collapsible scope section in the Browse view.
function ScopeSection({
  scope,
  typeFilter,
  onMove,
  defaultOpen,
}: {
  scope: DriveScope;
  typeFilter: DriveTypeFilter;
  onMove: (args: DriveTreeMoveArgs) => void;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const isLab = scope.id === "lab";

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

  return (
    <section
      className="bg-card border border-border rounded-lg overflow-hidden"
      data-testid={`drive-scope-${scope.id}`}
    >
      {/* Scope header — lab gets a group icon, projects get a folder icon + badge */}
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-muted/40 transition-colors"
      >
        <span className="flex items-center gap-2 min-w-0">
          {open ? (
            <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0 -rotate-90" />
          )}
          {isLab ? (
            <Users className="w-4 h-4 text-muted-foreground shrink-0" />
          ) : scope.iconEmoji ? (
            <span className="text-sm leading-none">{scope.iconEmoji}</span>
          ) : (
            <FolderIcon className="w-4 h-4 text-muted-foreground shrink-0" />
          )}
          <span className="font-semibold text-foreground text-sm truncate">
            {isLab ? "Lab" : scope.label}
          </span>
          {!isLab && (
            <span className="text-[10px] uppercase tracking-wide text-accent-coral/70 shrink-0">
              Project
            </span>
          )}
          {!open && filteredCount > 0 && (
            <span className="text-[11px] text-muted-foreground shrink-0">
              ({filteredCount})
            </span>
          )}
        </span>
      </button>

      {open && (
        <div className="border-t border-border px-2 pb-2">
          <DriveTree scopeId={scope.id} items={treeItems} onMove={onMove} />
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
  const revalidator = useRevalidator();
  const dialog = useDialog();
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false);

  const { inputRef, uploading, uploadError, handleFileChange } = useLabFileUpload(() => {
    revalidator.revalidate();
  });

  const handleMove = useCallback(async (args: DriveTreeMoveArgs) => {
    const { item, srcScopeId, destFolderId, destScopeId } = args;

    if (srcScopeId !== destScopeId) {
      const destScope = driveScopes.find((s) => s.id === destScopeId);
      const leavingProject = srcScopeId !== "lab";
      const confirmed = await dialog.confirm({
        title: `Move "${item.title}" to ${destScope?.label ?? destScopeId}?`,
        description:
          `People with access where it is now will lose it; people in the destination will gain access.` +
          (leavingProject ? " Partner and public sharing will be turned off." : ""),
        confirmLabel: "Move",
      });
      if (!confirmed) return;
    }

    try {
      if (item.type === "doc" || item.type === "folder") {
        const sameScope = srcScopeId === destScopeId;
        const destPayload = sameScope
          ? {}
          : destScopeId === "lab"
          ? { workspaceType: "Lab", workspaceId: null }
          : { workspaceType: "Project", workspaceId: destScopeId };

        const res = await fetch(`/api/pages/${item.id}/move`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ parentPageId: destFolderId, ...destPayload }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({})) as { error?: string };
          console.error("Drive move failed:", body.error ?? res.statusText);
        }
      } else {
        const res = await fetch("/api/drive/move", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            itemType: item.type,
            itemId: item.id,
            destFolderPageId: destFolderId,
          }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({})) as { error?: string };
          console.error("Drive move failed:", body.error ?? res.statusText);
        }
      }
    } finally {
      revalidator.revalidate();
    }
  }, [driveScopes, dialog, revalidator]);

  // Visible filter chips: always show All/Documents/Files; role-gate Forms and
  // Agreements (Core-only).
  const caps = { canViewForms, canManageAgreements };
  const visibleFilters = TYPE_FILTERS.filter(
    (f) => !f.requiresCap || caps[f.requiresCap],
  );

  // Navigate to the new agreement detail page once the fetcher resolves.
  // The admin create action returns a redirect (302) which the fetcher follows,
  // but useFetcher catches the final non-redirect response — the action returns
  // redirect(`/admin/agreements/${doc.id}`) which the fetcher resolves to the
  // loader data of that page. We instead navigate imperatively from the fetcher
  // data if it contains an id, or rely on the window.location.assign below.
  // Actually: the action POSTs to /admin/agreements and redirects — the fetcher
  // will NOT follow the redirect; we need to extract the Location header.
  // Simpler: use fetch() directly so we control the redirect behaviour.
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
      // Don't follow the redirect — grab the Location header instead.
      redirect: "manual",
    });
    // fetch in "manual" mode gives a type:"opaqueredirect" response with no
    // Location header accessible in JS (CORS). Use redirect:"follow" but
    // detect the final URL from res.url.
    if (res.ok || res.redirected) {
      // The admin action redirects to /admin/agreements/<id>; if drive-
      // consolidation is on, the admin loader itself redirects to
      // /documents/agreement/<id>. Either way res.url is the final URL.
      const finalUrl = res.url;
      // Rewrite admin path to drive path when we landed on the admin route.
      const driveUrl = finalUrl.replace(
        /\/admin\/agreements\/([^/]+)$/,
        "/documents/agreement/$1",
      );
      window.location.assign(driveUrl);
    }
  }

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
      {/* Type filter chip row + New menu, kept together on one line */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
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

        {/* New ▾ menu: create doc/folder/form, from template, or upload file */}
        {/* Hidden file input — triggered by the Upload file menu item click */}
        <input
          ref={inputRef}
          type="file"
          className="sr-only"
          aria-hidden="true"
          tabIndex={-1}
          onChange={handleFileChange}
        />

        <Menu
          align="right"
          ariaLabel="New item"
          trigger={
            <button
              type="button"
              data-testid="drive-new-menu"
              className="inline-flex items-center gap-1.5 bg-accent-coral px-3 py-1.5 text-sm font-medium text-white rounded-md hover:bg-accent-coral/90"
            >
              <Plus className="w-4 h-4" /> New
              <ChevronDown className="w-3.5 h-3.5 opacity-70" />
            </button>
          }
        >
          {/* New document: POST /api/lab-documents then navigate to the new doc */}
          <Menu.Item
            icon={<FileText className="w-3.5 h-3.5" />}
            onSelect={async () => {
              const res = await fetch("/api/lab-documents", {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ title: "Untitled", kind: "FreeForm" }),
              });
              if (res.ok) {
                const { id } = await res.json() as { id: string };
                window.location.assign(`/documents/${id}`);
              }
            }}
          >
            <span data-testid="drive-new-doc">New document</span>
          </Menu.Item>
          {/* New folder: POST /api/lab-documents with kind=Folder (stays on Drive) */}
          <Menu.Item
            icon={<FolderOpen className="w-3.5 h-3.5" />}
            onSelect={async () => {
              const res = await fetch("/api/lab-documents", {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ title: "New folder", kind: "Folder" }),
              });
              if (res.ok) revalidator.revalidate();
            }}
          >
            <span data-testid="drive-new-folder">New folder</span>
          </Menu.Item>
          {/* New form: navigate to the existing /forms create flow */}
          {canViewForms && (
            <Menu.Item
              icon={<ClipboardList className="w-3.5 h-3.5" />}
              onSelect={() => window.location.assign("/forms")}
            >
              <span data-testid="drive-new-form">New form</span>
            </Menu.Item>
          )}
          {/* New agreement: Core-only. POSTs to the existing admin create action
              and navigates to the Drive-namespaced detail route. */}
          {canManageAgreements && (
            <Menu.Item
              icon={<FileSignature className="w-3.5 h-3.5" />}
              onSelect={() => void createAgreement()}
            >
              <span data-testid="drive-new-agreement">New agreement</span>
            </Menu.Item>
          )}
          <Menu.Separator />
          {/* From template: opens a picker that lists Lab page templates.
              Templates are a creation aid, not a browse destination — this is
              the only templates surface in the Drive. */}
          <Menu.Item
            icon={<LayoutTemplate className="w-3.5 h-3.5" />}
            onSelect={() => setTemplatePickerOpen(true)}
          >
            <span data-testid="drive-new-template">From template…</span>
          </Menu.Item>
          {/* Upload file: presign → PUT S3 → POST /api/drive/files (Lab scope).
              Reuses the same presign flow as AssignmentWorkArea + ProjectImageBanner. */}
          <Menu.Item
            icon={<Upload className="w-3.5 h-3.5" />}
            disabled={uploading}
            onSelect={() => inputRef.current?.click()}
          >
            <span data-testid="drive-new-upload">
              {uploading ? "Uploading…" : "Upload file"}
            </span>
          </Menu.Item>
        </Menu>
      </div>

      {/* Upload error toast (inline, dismisses automatically on next upload) */}
      {uploadError && (
        <p className="text-sm text-red-600 px-1">{uploadError}</p>
      )}

      {/* Template picker modal */}
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
              onMove={handleMove}
              defaultOpen={scope.id === "lab"}
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
