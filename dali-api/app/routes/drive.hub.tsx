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
  ChevronDown,
} from "lucide-react";
import { useState } from "react";
import { requireAuth, redirectPartnerToPortal } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { canViewForms as checkCanViewForms } from "~/lib/roles";
import { loadFormsLevel } from "~/forms/lib/forms-data";
import { FormsBrowser } from "~/forms/components/FormsBrowser";
import { loader as docsLoader, DocumentsHubBody } from "~/routes/documents.hub";
import { listMySignedDocuments } from "~/signing/lib/state.server";
import { loadTemplates } from "~/lib/drive-templates.server";
import { loadDriveScopes } from "~/lib/drive-scopes.server";
import type { DriveTreeScope } from "~/lib/drive-scopes.server";
import { formatDateTime } from "~/lib/display";
import { useUserTimeZone } from "~/hooks/useUserTimeZone";
import type { TemplateKind, TemplateItem } from "~/lib/drive-templates.server";
import { Link } from "react-router";
import { DriveTree } from "~/components/drive/DriveTree";
import type { DriveTreeMoveArgs } from "~/components/drive/DriveTree";
import { useDialog } from "~/components/ui/dialog";
import { Menu } from "~/components/ui/floating";

export const meta: Route.MetaFunction = () => [{ title: "Drive · DALI OS" }];

// The unified Drive hub, surfaced when the drive-consolidation feature flag is
// on. Presents a unified Browse tree (folders + docs + files + forms per scope)
// plus existing read-only lenses: Agreements and Templates. The Forms lens is
// kept for creation/management; the old Documents and Files lenses are folded
// into Browse. When the flag is off, /drive redirects to /documents.
export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  if (auth.user.type === "applicant") return redirect("/portal");
  const partnerRedirect = await redirectPartnerToPortal(auth);
  if (partnerRedirect) return partnerRedirect;

  const userCanViewForms = await checkCanViewForms(auth.user.sub);

  // Delegate to the existing documents loader so the docs lens is always
  // identical to /documents. The loader does its own auth check (cached for
  // the request), so the double call is free in practice.
  const docsResult = await docsLoader({ request } as Parameters<typeof docsLoader>[0]);
  // Surface any redirect the docs loader produces (e.g., re-auth).
  if (docsResult instanceof Response) return docsResult;

  // Identify the project workspaces the viewer can see — already access-scoped
  // by the docs loader, so loadDriveScopes can safely call loadDriveScope for each.
  const projectWorkspaces = docsResult.workspaces.filter((w) => w.kind === "project");

  // Load all per-scope DriveItems. The helper is in drive-scopes.server.ts so
  // this file's client bundle never includes the prisma import.
  const driveScopes = await loadDriveScopes({
    userSub: auth.user.sub,
    projectWorkspaces,
    canViewForms: userCanViewForms,
    request,
  });

  // Load top-level forms data only when the user can see forms (for the Forms
  // management lens — tree browses/moves forms, but creation stays in FormsBrowser).
  const formsData = userCanViewForms ? await loadFormsLevel(null) : null;

  // Agreements — always loaded (the viewer only ever sees their own).
  const signedDocs = await listMySignedDocuments(auth.user.sub);

  // Templates — load for all viewers; loadTemplates gates each category internally.
  const templatesData = await loadTemplates(auth.user.sub);

  return {
    docsData: docsResult,
    driveScopes,
    formsData,
    canViewForms: userCanViewForms,
    signedDocs,
    templatesData,
  };
}

type LoaderData = Exclude<Awaited<ReturnType<typeof loader>>, Response>;
type DriveScope = LoaderData["driveScopes"][number];

const KIND_LABELS: Record<TemplateKind, string> = {
  page: "Document templates",
  form: "Form drafts",
  mentorNote: "Mentor note templates",
  email: "Email templates",
  signing: "Agreement templates",
};

function TemplatesLens({ templatesData }: { templatesData: LoaderData["templatesData"] }) {
  const { items } = templatesData;

  // Group by kind, preserving a stable display order.
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

// ── Browse lens (unified DriveTree per scope) ──────────────────────────────────

// One collapsible scope section in the Browse view.
function ScopeSection({
  scope,
  onMove,
  defaultOpen,
}: {
  scope: DriveScope;
  onMove: (args: DriveTreeMoveArgs) => void;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const isLab = scope.id === "lab";

  return (
    <section className="bg-card border border-border rounded-lg overflow-hidden">
      {/* Scope header row */}
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
          {scope.iconEmoji ? (
            <span className="text-sm leading-none">{scope.iconEmoji}</span>
          ) : (
            <FolderOpen className="w-4 h-4 text-muted-foreground shrink-0" />
          )}
          <span className="font-medium text-foreground text-sm truncate">{scope.label}</span>
          {!isLab && (
            <span className="text-[10px] uppercase tracking-wide text-accent-coral/70 shrink-0">
              Project
            </span>
          )}
          {!open && scope.items.length > 0 && (
            <span className="text-[11px] text-muted-foreground shrink-0">
              ({scope.items.length})
            </span>
          )}
        </span>
      </button>

      {open && (
        <div className="border-t border-border px-2 pb-2">
          <DriveTree scopeId={scope.id} items={scope.items} onMove={onMove} />
        </div>
      )}
    </section>
  );
}

function BrowseLens({
  driveScopes,
  canViewForms,
}: {
  driveScopes: DriveScope[];
  canViewForms: boolean;
}) {
  const revalidator = useRevalidator();
  const dialog = useDialog();

  // Submit a move to the right endpoint, after cross-scope confirm if needed.
  async function handleMove(args: DriveTreeMoveArgs) {
    const { item, srcScopeId, destFolderId, destScopeId } = args;

    // Cross-scope: confirm before posting. Mirrors the confirm pattern in
    // documents.hub.tsx moveDocument (same copy, same tone).
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

    // Route the move to the correct endpoint based on item type.
    // Docs and folders go through POST /api/pages/:id/move (workspace-aware).
    // Files and forms go through POST /api/drive/move (folderPageId only).
    try {
      if (item.type === "doc" || item.type === "folder") {
        // Build the workspace payload when crossing scopes.
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
        // file or form — folderPageId placement only (no workspace move).
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
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Everything in one place — drag items into folders or between scopes.
          {canViewForms && " Forms can also be managed in the Forms tab."}
        </p>
        {/* Create shortcuts so new-doc/form/upload flows stay reachable from
            the Browse lens without the user switching away. */}
        <Menu
          align="right"
          ariaLabel="New item"
          trigger={
            <button
              type="button"
              className="inline-flex items-center gap-1.5 bg-accent-coral px-3 py-1.5 text-sm font-medium text-white rounded-md hover:bg-accent-coral/90"
            >
              <Plus className="w-4 h-4" /> New
            </button>
          }
        >
          <Menu.Item
            icon={<FileText className="w-3.5 h-3.5" />}
            onSelect={() => window.location.assign("/documents")}
          >
            New document
          </Menu.Item>
          {canViewForms && (
            <Menu.Item
              icon={<ClipboardList className="w-3.5 h-3.5" />}
              onSelect={() => window.location.assign("/forms")}
            >
              New form
            </Menu.Item>
          )}
          <Menu.Item
            icon={<Paperclip className="w-3.5 h-3.5" />}
            onSelect={() => window.location.assign("/projects")}
          >
            Upload file (in a project)
          </Menu.Item>
        </Menu>
      </div>

      {driveScopes.map((scope, i) => (
        <ScopeSection
          key={scope.id}
          scope={scope}
          onMove={handleMove}
          // Lab scope defaults open; projects default closed (same convention as
          // the ProjectFolderRow in documents.hub.tsx).
          defaultOpen={scope.id === "lab"}
        />
      ))}
    </div>
  );
}

// ── Hub shell ─────────────────────────────────────────────────────────────────

type Lens = "browse" | "forms" | "agreements" | "templates" | "docs";

export default function DriveHub() {
  const { docsData, driveScopes, formsData, canViewForms, signedDocs, templatesData } =
    useLoaderData() as LoaderData;
  const [searchParams, setSearchParams] = useSearchParams();

  // Default lens: "browse". Guard against invalid or gated lens values.
  const rawLens = searchParams.get("lens") as Lens | null;
  const lens: Lens =
    rawLens === "forms" && canViewForms
      ? "forms"
      : rawLens === "agreements"
        ? "agreements"
        : rawLens === "templates"
          ? "templates"
          : rawLens === "docs"
            ? "docs"
            : "browse";

  function switchLens(next: Lens) {
    setSearchParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        p.set("lens", next);
        return p;
      },
      { replace: true },
    );
  }

  const pillBase =
    "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors";
  const pillActive = "bg-accent-coral/10 text-accent-coral";
  const pillInactive = "text-muted-foreground hover:text-foreground hover:bg-muted/60";

  return (
    <div className="w-full flex flex-col gap-4 p-4">
      {/* Header + lens picker */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <HardDrive className="w-5 h-5 text-accent-coral" />
          <h1 className="text-lg font-semibold text-foreground">Drive</h1>
        </div>
        <div className="inline-flex rounded-md border border-border bg-card p-0.5">
          {/* Browse is the primary lens — unified tree of all types. */}
          <button
            type="button"
            aria-pressed={lens === "browse"}
            onClick={() => switchLens("browse")}
            className={`${pillBase} ${lens === "browse" ? pillActive : pillInactive}`}
          >
            <FolderOpen className="w-4 h-4" />
            Browse
          </button>
          {canViewForms && (
            <button
              type="button"
              aria-pressed={lens === "forms"}
              onClick={() => switchLens("forms")}
              className={`${pillBase} ${lens === "forms" ? pillActive : pillInactive}`}
            >
              <ClipboardList className="w-4 h-4" />
              Forms
            </button>
          )}
          <button
            type="button"
            aria-pressed={lens === "agreements"}
            onClick={() => switchLens("agreements")}
            className={`${pillBase} ${lens === "agreements" ? pillActive : pillInactive}`}
          >
            <FileSignature className="w-4 h-4" />
            Agreements
          </button>
          <button
            type="button"
            aria-pressed={lens === "templates"}
            onClick={() => switchLens("templates")}
            className={`${pillBase} ${lens === "templates" ? pillActive : pillInactive}`}
          >
            <LayoutTemplate className="w-4 h-4" />
            Templates
          </button>
          {/* Docs lens kept for power users who prefer the filtered/search view
              from documents.hub. Not shown in the pill row by default — it's
              reachable via ?lens=docs or from /documents directly. */}
        </div>
      </div>

      {/* Lens content */}
      {lens === "browse" ? (
        <BrowseLens driveScopes={driveScopes} canViewForms={canViewForms} />
      ) : lens === "forms" ? (
        formsData && (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">
              Create forms and organize them into folders. Click a folder to
              open it. Editing a form's questions appends a new version; anyone
              filling it out sees the latest.
            </p>
            <FormsBrowser
              folderId={null}
              parentId={null}
              folders={formsData.folders}
              forms={formsData.forms}
              allFolders={formsData.allFolders}
              allForms={formsData.allForms}
            />
          </div>
        )
      ) : lens === "agreements" ? (
        <AgreementsLens signedDocs={signedDocs} />
      ) : lens === "templates" ? (
        <TemplatesLens templatesData={templatesData} />
      ) : (
        // lens === "docs": full documents hub body for power users / deep links
        <DocumentsHubBody {...docsData} />
      )}
    </div>
  );
}
