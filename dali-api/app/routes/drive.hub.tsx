import { redirect, useLoaderData, useSearchParams, useRevalidator } from "react-router";
import type { Route } from "./+types/drive.hub";
import {
  HardDrive,
  FileText,
  ClipboardList,
  FileSignature,
  LayoutTemplate,
  CheckCircle2,
  Download,
  ExternalLink,
  Paperclip,
  FolderOpen,
  Plus,
  Users,
  ChevronDown,
  Folder as FolderIcon,
} from "lucide-react";
import { useState, useCallback } from "react";
import { requireAuth, redirectPartnerToPortal } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { canViewForms as checkCanViewForms } from "~/lib/roles";
import { loader as docsLoader } from "~/routes/documents.hub";
import { listMySignedDocuments } from "~/signing/lib/state.server";
import { loadTemplates } from "~/lib/drive-templates.server";
import { loadDriveScopes } from "~/lib/drive-scopes.server";
import type { DriveTreeScope } from "~/lib/drive-scopes.server";
import { formatDateTime } from "~/lib/display";
import { useUserTimeZone } from "~/hooks/useUserTimeZone";
import type { TemplateKind, TemplateItem } from "~/lib/drive-templates.server";
import type { DriveItem } from "~/lib/drive.server";
import { Link } from "react-router";
import { DriveTree } from "~/components/drive/DriveTree";
import type { DriveTreeMoveArgs } from "~/components/drive/DriveTree";
import { useDialog } from "~/components/ui/dialog";
import { Menu } from "~/components/ui/floating";

export const meta: Route.MetaFunction = () => [{ title: "Drive · DALI OS" }];

// The unified Drive hub, surfaced when the drive-consolidation feature flag is
// on. Browse is the only main view — Agreements and Templates are demoted to a
// secondary, visually subordinate row rather than first-class pills. A type
// filter chip row (All · Documents · Files · Forms) filters the tree without
// creating a separate lens. The legacy Forms lens (FormsBrowser grid) is
// removed; forms appear in the unified tree.
export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  if (auth.user.type === "applicant") return redirect("/portal");
  const partnerRedirect = await redirectPartnerToPortal(auth);
  if (partnerRedirect) return partnerRedirect;

  const userCanViewForms = await checkCanViewForms(auth.user.sub);

  const docsResult = await docsLoader({ request } as Parameters<typeof docsLoader>[0]);
  if (docsResult instanceof Response) return docsResult;

  const projectWorkspaces = docsResult.workspaces.filter((w) => w.kind === "project");

  const driveScopes = await loadDriveScopes({
    userSub: auth.user.sub,
    projectWorkspaces,
    canViewForms: userCanViewForms,
    request,
  });

  const signedDocs = await listMySignedDocuments(auth.user.sub);
  const templatesData = await loadTemplates(auth.user.sub);

  return {
    driveScopes,
    canViewForms: userCanViewForms,
    signedDocs,
    templatesData,
  };
}

type LoaderData = Exclude<Awaited<ReturnType<typeof loader>>, Response>;
type DriveScope = LoaderData["driveScopes"][number];

// ── Type filter ────────────────────────────────────────────────────────────────

export type DriveTypeFilter = "all" | "doc" | "file" | "form";

const TYPE_FILTERS: { value: DriveTypeFilter; label: string; icon: React.ReactNode }[] = [
  { value: "all", label: "All", icon: null },
  { value: "doc", label: "Documents", icon: <FileText className="w-3.5 h-3.5" /> },
  { value: "file", label: "Files", icon: <Paperclip className="w-3.5 h-3.5" /> },
  { value: "form", label: "Forms", icon: <ClipboardList className="w-3.5 h-3.5" /> },
];

// ── Secondary shelves (Agreements + Templates) ─────────────────────────────────

const KIND_LABELS: Record<TemplateKind, string> = {
  page: "Document templates",
  form: "Form drafts",
  mentorNote: "Mentor note templates",
  email: "Email templates",
  signing: "Agreement templates",
};

function TemplatesLens({ templatesData }: { templatesData: LoaderData["templatesData"] }) {
  const { items } = templatesData;

  const ORDER: TemplateKind[] = ["page", "form", "mentorNote", "email", "signing"];
  const byKind: Partial<Record<TemplateKind, TemplateItem[]>> = {};
  for (const item of items) {
    (byKind[item.kind] ??= []).push(item);
  }

  const populated = ORDER.filter((k) => (byKind[k]?.length ?? 0) > 0);

  if (populated.length === 0) {
    return (
      <p className="text-sm text-muted-foreground italic">
        No templates are available to you yet.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      {populated.map((kind) => (
        <section key={kind}>
          <h2 className="text-sm font-semibold text-foreground/70 mb-3">
            {KIND_LABELS[kind]}
          </h2>
          <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {byKind[kind]!.map((item) => (
              <li
                key={item.id}
                className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3"
              >
                <div className="flex items-start gap-2 min-w-0">
                  <LayoutTemplate className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                  <div className="min-w-0">
                    <p className="font-medium text-foreground text-sm truncate">{item.name}</p>
                    {item.description && (
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                        {item.description}
                      </p>
                    )}
                  </div>
                </div>
                <Link
                  to={item.useHref}
                  className="self-start inline-flex items-center gap-1 text-xs font-medium text-accent-coral hover:underline"
                >
                  <ExternalLink className="w-3 h-3" />
                  {kind === "page" ? "Browse" : kind === "form" ? "Open" : "View"}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function AgreementsLens({ signedDocs }: { signedDocs: LoaderData["signedDocs"] }) {
  const tz = useUserTimeZone();

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Your signed lab agreements — read-only archive. To sign a pending
        agreement, visit Settings → Agreements.
      </p>
      {signedDocs.length === 0 ? (
        <p className="text-sm text-muted-foreground italic">
          You haven't signed any agreements yet.
        </p>
      ) : (
        <ul className="space-y-2">
          {signedDocs.map((s) => (
            <li
              key={s.signatureId}
              className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card p-3"
            >
              <span className="flex items-center gap-2 min-w-0">
                <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" />
                <span className="min-w-0">
                  <span className="block font-medium text-foreground text-sm truncate">
                    {s.documentName}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {s.context} · signed {formatDateTime(s.signedAt, tz)}
                  </span>
                </span>
              </span>
              <span className="flex items-center gap-3 shrink-0">
                <Link
                  to={`/sign/${s.bindingId}`}
                  className="text-sm font-medium text-accent-coral hover:underline"
                >
                  View
                </Link>
                <a
                  href={`/sign/${s.bindingId}?format=pdf`}
                  className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
                  title="Download PDF"
                >
                  <Download className="w-4 h-4" /> PDF
                </a>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Secondary-shelf popover (Agreements / Templates) ──────────────────────────

// A lightweight expandable panel for the demoted shelves. We use the same
// inline toggle pattern as ScopeSection rather than a modal — these are
// secondary collections, not primary navigation.
function SecondaryShelf({
  label,
  icon,
  testId,
  children,
}: {
  label: string;
  icon: React.ReactNode;
  testId: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-lg border border-border bg-card/50 overflow-hidden" data-testid={testId}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-4 py-2.5 text-left hover:bg-muted/30 transition-colors"
      >
        <span className="flex items-center gap-2 flex-1 min-w-0">
          {icon}
          <span className="text-sm font-medium text-muted-foreground">{label}</span>
        </span>
        <ChevronDown
          className={`w-3.5 h-3.5 text-muted-foreground transition-transform ${open ? "" : "-rotate-90"}`}
        />
      </button>
      {open && (
        <div className="border-t border-border px-4 py-4">
          {children}
        </div>
      )}
    </div>
  );
}

// ── Browse scope section ───────────────────────────────────────────────────────

// A flat list of items matching the active type filter. Shown instead of the
// nested tree when type !== "all". Folders are excluded — what matters when
// searching by type is the matching items, with scope/folder as context.
function FlatItemList({
  items,
  typeFilter,
  scopeLabel,
}: {
  items: DriveItem[];
  typeFilter: Exclude<DriveTypeFilter, "all">;
  scopeLabel: string;
}) {
  const matched = items.filter((it) => it.type === typeFilter);

  if (matched.length === 0) {
    return (
      <p className="py-3 px-2 text-sm text-muted-foreground italic">
        No {typeFilter === "doc" ? "documents" : typeFilter === "file" ? "files" : "forms"} in {scopeLabel}.
      </p>
    );
  }

  // Build a lookup from folder id → folder title for the subtitle context line.
  const folderTitles = new Map<string, string>(
    items
      .filter((it) => it.type === "folder")
      .map((it) => [it.id, it.title || "Untitled folder"]),
  );

  return (
    <ul className="flex flex-col divide-y divide-border/60">
      {matched.map((item) => {
        const icon =
          item.type === "file" ? (
            <Paperclip className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          ) : item.type === "form" ? (
            <ClipboardList className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          ) : (
            <FileText className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          );

        const parentTitle =
          item.parentFolderId ? folderTitles.get(item.parentFolderId) : null;

        return (
          <li
            key={item.id}
            data-testid={`drive-item-${item.type}-${item.id}`}
            className="flex items-center gap-2 py-2 px-2 hover:bg-muted/20 rounded transition-colors"
          >
            {icon}
            <span className="min-w-0 flex-1">
              <Link
                to={item.href}
                className="block truncate font-medium text-foreground text-sm hover:text-accent-coral transition-colors"
              >
                {item.title || "Untitled"}
              </Link>
              {parentTitle && (
                <span className="block text-xs text-muted-foreground truncate">
                  in {parentTitle}
                </span>
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

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
          {typeFilter === "all" ? (
            <DriveTree scopeId={scope.id} items={scope.items} onMove={onMove} />
          ) : (
            <FlatItemList
              items={scope.items}
              typeFilter={typeFilter}
              scopeLabel={isLab ? "Lab" : scope.label}
            />
          )}
        </div>
      )}
    </section>
  );
}

// ── Browse view (the only main view) ──────────────────────────────────────────

function BrowseView({
  driveScopes,
  canViewForms,
  typeFilter,
  onTypeFilterChange,
}: {
  driveScopes: DriveScope[];
  canViewForms: boolean;
  typeFilter: DriveTypeFilter;
  onTypeFilterChange: (f: DriveTypeFilter) => void;
}) {
  const revalidator = useRevalidator();
  const dialog = useDialog();

  const handleMove = useCallback(async (args: DriveTreeMoveArgs) => {
    const { item, srcScopeId, destFolderId, destScopeId } = args;

    if (srcScopeId !== destScopeId) {
      const srcScope = driveScopes.find((s) => s.id === srcScopeId);
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

  // Visible filter chips: always show All/Documents/Files; only show Forms when
  // the viewer has manage-forms access.
  const visibleFilters = TYPE_FILTERS.filter(
    (f) => f.value !== "form" || canViewForms,
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

        {/* New ▾ menu: create doc/folder/form or navigate to file upload */}
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
            New document
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
            New folder
          </Menu.Item>
          {/* New form: navigate to the existing /forms create flow */}
          {canViewForms && (
            <Menu.Item
              icon={<ClipboardList className="w-3.5 h-3.5" />}
              onSelect={() => window.location.assign("/forms")}
            >
              New form
            </Menu.Item>
          )}
          {/* Upload file: project files live in project workspaces */}
          <Menu.Item
            icon={<Paperclip className="w-3.5 h-3.5" />}
            onSelect={() => window.location.assign("/projects")}
          >
            Upload file (in a project)
          </Menu.Item>
        </Menu>
      </div>

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
                : "forms"}{" "}
              in any of your drives.
            </p>
          )}
        </>
      )}
    </div>
  );
}

// ── Hub shell ─────────────────────────────────────────────────────────────────

// The secondary shelf that's currently expanded in the header area.
type SecondaryPane = "agreements" | "templates" | null;

export default function DriveHub() {
  const { driveScopes, canViewForms, signedDocs, templatesData } =
    useLoaderData() as LoaderData;
  const [searchParams, setSearchParams] = useSearchParams();

  // Type filter comes from ?type= (default "all").
  const rawType = searchParams.get("type") as DriveTypeFilter | null;
  const typeFilter: DriveTypeFilter =
    rawType === "doc" || rawType === "file" || rawType === "form" ? rawType : "all";

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

  const [secondaryPane, setSecondaryPane] = useState<SecondaryPane>(null);
  function togglePane(pane: SecondaryPane) {
    setSecondaryPane((cur) => (cur === pane ? null : pane));
  }

  // Shared link style for the secondary actions.
  const secondaryLink =
    "inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors";

  return (
    <div className="w-full flex flex-col gap-4 p-4">
      {/* Header row: Drive title + secondary shelf links */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <HardDrive className="w-5 h-5 text-accent-coral" />
          <h1 className="text-lg font-semibold text-foreground">Drive</h1>
        </div>

        {/* Agreements + Templates: demoted to right-aligned secondary links.
            They're distinct collections (read-only archive + cross-system gallery),
            not peers of the filesystem, so they live outside the main filter row. */}
        <div className="flex items-center gap-4">
          <button
            type="button"
            aria-pressed={secondaryPane === "agreements"}
            onClick={() => togglePane("agreements")}
            className={secondaryLink}
            data-testid="drive-shelf-agreements"
          >
            <FileSignature className="w-3.5 h-3.5" />
            Agreements
          </button>
          <button
            type="button"
            aria-pressed={secondaryPane === "templates"}
            onClick={() => togglePane("templates")}
            className={secondaryLink}
            data-testid="drive-shelf-templates"
          >
            <LayoutTemplate className="w-3.5 h-3.5" />
            Templates
          </button>
        </div>
      </div>

      {/* Secondary shelves — expand inline beneath the header when activated */}
      {secondaryPane === "agreements" && (
        <SecondaryShelf
          label="My Agreements"
          icon={<FileSignature className="w-4 h-4 text-muted-foreground" />}
          testId="drive-shelf-agreements-panel"
        >
          <AgreementsLens signedDocs={signedDocs} />
        </SecondaryShelf>
      )}
      {secondaryPane === "templates" && (
        <SecondaryShelf
          label="Templates"
          icon={<LayoutTemplate className="w-4 h-4 text-muted-foreground" />}
          testId="drive-shelf-templates-panel"
        >
          <TemplatesLens templatesData={templatesData} />
        </SecondaryShelf>
      )}

      {/* Browse is the sole main view */}
      <BrowseView
        driveScopes={driveScopes}
        canViewForms={canViewForms}
        typeFilter={typeFilter}
        onTypeFilterChange={setTypeFilter}
      />
    </div>
  );
}
