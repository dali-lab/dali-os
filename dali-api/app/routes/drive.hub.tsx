import { redirect, useLoaderData, useSearchParams, useNavigate, useRevalidator, useLocation } from "react-router";
import type { ShouldRevalidateFunctionArgs } from "react-router";
import type { Route } from "./+types/drive.hub";
import { FileText, ClipboardList, FileSignature, Paperclip, Plus, ChevronDown, LayoutTemplate, Upload, Tag as TagIcon, Trash2, MoreHorizontal, X, Shapes, Presentation, NotebookPen } from "lucide-react";
import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import type { ReactNode } from "react";
import { requireLabViewer } from "~/lib/lab-viewer.server";
import { getUserRoles } from "~/lib/roles";
import { resolveTermFilter } from "~/lib/terms";
import { setPageFavorite } from "~/components/favorites-live";
import { TermFilter } from "~/components/TermFilter";
import { loadProjectWorkspaces, loadEducationWorkspaces, loadAllDocTags, loadItemTagIds } from "~/drive/lib/drive-hub.server";
import { loadDriveScopes } from "~/drive/lib/drive-scopes.server";
import type { DriveTreeScope } from "~/drive/lib/drive-scopes.server";
import type { DriveItem } from "~/drive/lib/drive.server";
import { DriveBrowser } from "~/components/drive/DriveBrowser";
import type { FileDropOptions, RowActions } from "~/components/drive/DriveBrowser";
import { DriveTagFilter } from "~/components/drive/DriveTagFilter";
import { DRIVE_TOOLBAR_BTN, DRIVE_TOOLBAR_ICON_BTN } from "~/components/drive/toolbar";
import { FolderPicker } from "~/components/drive/FolderPicker";
import type { PickerDrive, PickerFolder, Destination } from "~/components/drive/FolderPicker";
import { buildPickerRows } from "~/components/drive/picker-rows";
import { locateFolder, locationOf, type LocatableScope } from "~/components/drive/location";
import { itemTrail } from "~/components/notebooks/note-trail";
import { driveErrorFrom, isPageItem } from "~/components/drive/move-item";
import { destinationLabel } from "~/components/drive/action-toast";
import { reportMoveBatch, runHiddenMoveBatch, itemCount, type Landed } from "~/components/drive/move-batch";
import { withoutHidden, usePendingHidden } from "~/components/drive/pending-hidden";
import { runTrash } from "~/components/drive/trash-batch";
import { DriveHistoryContext, useDriveHistory, useDriveHistoryKeys } from "~/components/drive/use-drive-history";
import { useDriveFileUpload } from "~/components/drive/useDriveFileUpload";
import { DriveUploadInput } from "~/components/drive/DriveUploadInput";
import type { UploadDestination, UploadTarget } from "~/components/drive/useDriveFileUpload";
import { useDialog } from "~/components/ui/dialog";
import { useOpenBeside } from "~/components/side-panel/use-side-panel";
import { useToast } from "~/components/ui/toast";
import { driveNoticeMessage } from "~/drive/lib/drive-notices";
import { Menu, Select } from "~/components/ui/floating";
import { parseTypeFilter, type DriveTypeFilter } from "~/components/drive/type-filter";
import { cn } from "~/lib/cn";
import { isProcessRootSpace, isVirtualSpace, sharedSpaceItems, SHARED_SPACE_KEY } from "~/drive/lib/drive-spaces";
import { filterPillClass } from "~/components/ui/floating/styles";
import { NewMenu } from "~/components/drive/NewMenu";
import { TemplatePicker, type TemplateTarget } from "~/components/drive/TemplatePicker";
import { TrashPanel } from "~/components/drive/TrashPanel";
import { scopeKindOf, scopeAudience, scopeDest, folderAndDescendants, resolveWorkspaceId, makeScopeActions, type ScopeActions } from "~/components/drive/scope-actions";

export const meta: Route.MetaFunction = () => [{ title: "Drive · DALI OS" }];

// Drive is a single route whose meaningful context is the active scope (?scope=),
// each with different access rules — so the guide is keyed per scope rather than
// per route. Every project scope collapses to one `drive.project` guide (the
// default branch) to avoid a near-identical guide per project.
export const handle = {
  /** The open space and folder, for the page bar's trail. */
  shellTrail: (data: unknown, params: URLSearchParams) => {
    const scopes = (data as { driveScopes?: LocatableScope[] } | undefined)?.driveScopes;
    const scopeId = params.get("scope");
    if (!scopes || !scopeId) return null;
    const folderId = params.get("folder");
    const scope = scopes.find((s) => s.id === scopeId);
    const location = (folderId ? locateFolder(scopes, folderId) : null) ?? (scope ? locationOf(scope, null) : null);
    return location ? [{ label: "Drive", to: "/drive" }, ...itemTrail(location, "").slice(0, -1)] : null;
  },
  docKey: "drive.root",
  docTitle: "Drive",
  resolveDocKey: (params: URLSearchParams) => {
    const scope = params.get("scope");
    if (!scope) return { key: "drive.root", title: "Drive" };
    if (scope === "mine") return { key: "drive.mine", title: "My Drive" };
    if (scope === "shared") return { key: "drive.shared", title: "Shared with me" };
    if (scope === "lab") return { key: "drive.lab", title: "Lab-wide Drive" };
    if (scope === "core") return { key: "drive.core", title: "Core Drive" };
    if (scope === "hiring") return { key: "drive.hiring", title: "Hiring Drive" };
    if (scope === "mentorship") return { key: "drive.mentorship", title: "Mentorship Drive" };
    return { key: "drive.project", title: "Project Drive" };
  },
};

// The loader returns the FULL drive tree (every scope's items) and ignores the
// scope/folder/type query params — those only drive client-side view state. So
// navigating between scopes and folders needs no refetch: skip revalidation
// when only the query string changed on this same route — EXCEPT when the
// `?term=` param changes, which requires a real re-query (term-scoped spaces).
// Manual refreshes after a write (revalidator.revalidate(), which keeps the URL
// identical) and any non-GET submission still fall through to the default.
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
  const { auth } = await requireLabViewer(request);

  const userId = auth.user.sub;
  const [roles, termFilter] = await Promise.all([
    getUserRoles(userId, request),
    resolveTermFilter(request),
  ]);
  // isCore is the gate for agreement authoring. Passed down as canManageAgreements
  // so drive.server.ts doesn't re-derive it.
  const userCanManageAgreements = roles.isCore;

  // `?term=` scopes which project (and Education) drives appear, exactly as it
  // scopes the projects hub; "All terms" drops the gate so older drives stay
  // reachable. My Drive / General / Core are never term-filtered.
  const viewer = {
    userId,
    isCore: roles.isCore,
    termId: termFilter.isAll ? null : termFilter.termId,
  };

  // Only the item tags wait on the scopes (they're keyed by the ids the scopes
  // resolved to). Everything else starts now and is awaited together.
  const [{ driveScopes, itemTagIds }, allTags] = await Promise.all([
    (async () => {
      const [projectWorkspaces, educationWorkspaces] = await Promise.all([
        loadProjectWorkspaces(viewer),
        loadEducationWorkspaces(viewer),
      ]);
      const driveScopes = await loadDriveScopes({
        auth,
        projectWorkspaces,
        educationWorkspaces,
        canManageAgreements: userCanManageAgreements,
        isCore: roles.isCore,
        request,
      });
      return { driveScopes, itemTagIds: await loadItemTagIds(driveScopes) };
    })(),
    loadAllDocTags(),
  ]);

  return {
    driveScopes,
    allTags,
    itemTagIds,
    terms: termFilter.terms,
    selectedTerm: termFilter.selected,
    canManageAgreements: userCanManageAgreements,
    // My Drive is the Member workspace keyed by the viewer's own id — the
    // cross-drive move needs it to name the source workspace it's leaving.
    viewerId: userId,
  };
}

export type DriveHubData = Exclude<Awaited<ReturnType<typeof loader>>, Response>;
type LoaderData = DriveHubData;

export type DriveScope = LoaderData["driveScopes"][number];

// ── Type filter ────────────────────────────────────────────────────────────────

const TYPE_FILTERS: {
  value: DriveTypeFilter;
  label: string;
  icon: React.ReactNode;
  /** When set, chip is only visible if the viewer holds this capability. */
  requiresCap?: "canManageAgreements";
}[] = [
  { value: "all", label: "All", icon: null },
  { value: "doc", label: "Documents", icon: <FileText className="w-3.5 h-3.5" /> },
  { value: "notebook", label: "Notebooks", icon: <NotebookPen className="w-3.5 h-3.5" /> },
  { value: "whiteboard", label: "Whiteboards", icon: <Shapes className="w-3.5 h-3.5" /> },
  { value: "slides", label: "Slide decks", icon: <Presentation className="w-3.5 h-3.5" /> },
  { value: "file", label: "Files", icon: <Paperclip className="w-3.5 h-3.5" /> },
  { value: "form", label: "Forms", icon: <ClipboardList className="w-3.5 h-3.5" /> },
  { value: "agreement", label: "Agreements", icon: <FileSignature className="w-3.5 h-3.5" />, requiresCap: "canManageAgreements" },
  { value: "rubric", label: "Rubrics", icon: <ClipboardList className="w-3.5 h-3.5" />, requiresCap: "canManageAgreements" },
];

// ── Template picker ────────────────────────────────────────────────────────────

export default function DriveHub() {
  const {
    driveScopes: loadedScopes,
    allTags,
    itemTagIds,
    terms,
    selectedTerm,
    canManageAgreements,
    viewerId,
  } = useLoaderData() as LoaderData;
  const [searchParams, setSearchParams] = useSearchParams();
  const hubToast = useToast();
  // Reveal in Drive arrives with ?select=<id>, and a redirect into Drive can
  // carry ?notice=<key>: the browser takes each once, and they leave the URL so
  // a refresh or a shared link does not replay them.
  const [initialSelectedId] = useState(() => searchParams.get("select") ?? undefined);
  const [initialNotice] = useState(() => driveNoticeMessage(searchParams.get("notice")));
  useEffect(() => {
    if (initialNotice) hubToast.info(initialNotice);
    if (!initialSelectedId && !searchParams.has("notice")) return;
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("select");
        next.delete("notice");
        return next;
      },
      { replace: true },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const navigate = useNavigate();
  const dialog = useDialog();
  const toast = useToast();
  const revalidator = useRevalidator();
  const revalidate = useCallback(() => void revalidator.revalidate(), [revalidator]);
  const [revealId, setRevealId] = useState<string>();
  const onCreated = useCallback(
    (id: string) => {
      setRevealId(id);
      revalidate();
    },
    [revalidate],
  );
  const history = useDriveHistory({ onChange: revalidate });
  useDriveHistoryKeys(history);
  const pendingHidden = usePendingHidden(revalidator.state, loadedScopes);
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false);
  const [trashOpen, setTrashOpen] = useState(false);
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
  // when this same hub is embedded at /hiring/library, where it opens on the
  // Hiring space.
  const location = useLocation();
  const isHiringLibrary = location.pathname.startsWith("/hiring/library");
  const currentScopeId = searchParams.get("scope") ?? (isHiringLibrary ? "hiring" : null);
  const currentFolderId = searchParams.get("folder");
  const driveScopes = useMemo(
    () => loadedScopes.map((s) => (s.id === SHARED_SPACE_KEY ? { ...s, items: sharedSpaceItems(s.items) } : s)),
    [loadedScopes],
  );
  // In the URL like ?type= and ?term=, so "everything tagged onboarding" is a
  // link someone can send.
  const selectedTagIds = useMemo(
    () => new Set(searchParams.getAll("tag").filter(Boolean)),
    [searchParams],
  );
  const typeFilter = parseTypeFilter(searchParams.get("type"));

  const currentScope = useMemo(
    () => driveScopes.find((s) => s.id === currentScopeId) ?? null,
    [driveScopes, currentScopeId],
  );
  // What the browser shows: rows being moved or trashed are already gone.
  const visibleScopes = useMemo(
    () => withoutHidden(driveScopes, pendingHidden.ids),
    [driveScopes, pendingHidden.ids],
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
      { replace: opts?.replace ?? true, preventScrollReset: true },
    );
  }

  const onNavigate = useCallback(
    (scopeId: string | null, folderId: string | null) => {
      // Clicking into the tree leaves search mode.
      setSearch("");
      // Tree navigation PUSHES a history entry (unlike filter/search churn,
      // which replaces) so the browser Back button steps up the folder tree
      // instead of exiting Drive entirely.
      patchParams(
        (p) => {
          if (scopeId) p.set("scope", scopeId);
          else p.delete("scope");
          if (folderId) p.set("folder", folderId);
          else p.delete("folder");
        },
        { replace: false },
      );
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
      if (isVirtualSpace(scope.id)) continue;
      map.set(
        scope.id,
        makeScopeActions({
          scope,
          currentFolderId: scope.id === effectiveScopeId ? currentFolderId : null,
          dialog,
          toast,
          revalidate,
          onCreated,
          hiding: { hide: pendingHidden.hide },
          history,
        }),
      );
    }
    return map;
    // pendingHidden.hide is stable; the object changes with the hidden set, which the actions don't read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driveScopes, effectiveScopeId, currentFolderId, dialog, toast, revalidate, onCreated, history, pendingHidden.hide]);
  const scopeActionsRef = useRef(scopeActionsMap);
  scopeActionsRef.current = scopeActionsMap;

  // Dropping a selection onto a folder within the same drive.
  const onMove = useCallback(
    (scopeId: string, items: DriveItem[], destFolderId: string | null) => {
      const scope = driveScopes.find((s) => s.id === scopeId);
      const actions = scopeActionsMap.get(scopeId);
      if (!scope || !actions || items.length === 0) return;
      void (async () => {
        let failure: string | undefined;
        const landed = await runHiddenMoveBatch(
          items,
          (item) =>
            actions.performMove(item, destFolderId, {
              onError: (message) => {
                failure ??= message;
              },
            }),
          pendingHidden,
        );
        reportMoveBatch(
          { toast, history, revalidate },
          {
            landed,
            total: items.length,
            destination: destinationLabel(scope, destFolderId),
            forward: (l) => scopeActionsRef.current.get(scopeId)?.performMove(l.item, destFolderId) ?? Promise.resolve(false),
            back: (l) =>
              scopeActionsRef.current.get(scopeId)?.performMove({ ...l.item, parentFolderId: destFolderId }, l.folderId) ??
              Promise.resolve(false),
            failure: items.length === 1 ? failure : undefined,
          },
        );
      })();
    },
    [scopeActionsMap, driveScopes, toast, history, revalidate, pendingHidden],
  );

  const moveDestinationsFor = useCallback(
    (item: DriveItem): DriveTreeScope[] => {
      const home = driveScopes.find((s) => s.items.some((i) => i.id === item.id));
      return driveScopes.filter((s) => {
        if (s.id === "mine" || isVirtualSpace(s.id)) return false;
        // Items under a typed root stay in that root's drive.
        if (home?.rootFolderId && s.id !== home.id) return false;
        const kind = scopeKindOf(s.id);
        // A system folder keeps its workspace, so project and offering drives are out.
        if (
          item.type === "folder" &&
          (item as { folderType?: string | null }).folderType &&
          (kind === "project" || kind === "projects-group" || kind === "education-group")
        ) {
          return false;
        }
        // Files/forms move by folderPageId (no workspace change), so restrict
        // them to the Lab-workspace drives. Docs/folders can also move into
        // project/offering workspaces.
        const isDocOrFolder = isPageItem(item);
        if (!isDocOrFolder) {
          // Files/forms: Lab workspace only (no project/offering cross-move).
          return kind !== "project" && kind !== "projects-group" && kind !== "education-group";
        }
        // Docs/folders: include the synthetic group scopes so the picker shows
        // individual project/offering folders as drillable destinations.
        // The bare group ROOT is exposed as a drive row but the move handler
        // requires a specific project/offering folder to be selected.
        return true;
      });
    },
    [driveScopes],
  );

  // One item to a drive and folder, with no confirm and no reporting: the
  // batch below owns both. `onError` gets the reason a move was refused.
  const moveItemToScope = useCallback(
    async (
      item: DriveItem,
      sourceScopeId: string,
      destScopeId: string,
      destFolderPageId: string | null,
      onError?: (message: string) => void,
    ): Promise<boolean> => {
      const destScope = driveScopes.find((s) => s.id === destScopeId);
      if (!destScope) return false;
      const src = driveScopes.find((s) => s.id === sourceScopeId);
      const srcWs = src
        ? scopeDest(src, viewerId)
        : { workspaceType: "Lab" as const, workspaceId: null, root: null };

      // For the synthetic group scopes (projects/education), the destFolderPageId
      // IS the project/offering id when the user picks a synthetic top-level folder.
      // Resolve the workspace from the picked folder id so the move endpoint
      // receives the correct workspaceType/workspaceId rather than treating the
      // project/offering id as a real parentPageId.
      const destKind = scopeKindOf(destScopeId);
      let d: { workspaceType: "Lab" | "Project" | "EducationOffering"; workspaceId: string | null; root: string | null };
      let parent: string | null;
      if (destKind === "projects-group" || destKind === "education-group") {
        // Dropped at the bare group root — can't resolve a specific workspace.
        const wsId = destFolderPageId ? resolveWorkspaceId(destScope.items, destFolderPageId) : null;
        if (!destFolderPageId || !wsId) {
          onError?.("Select a project or offering to move into");
          return false;
        }
        // Whether the pick was ON the synthetic root (→ null parent) or inside a
        // real sub-folder (→ keep real parentPageId).
        const destNode = destScope.items.find((it) => it.id === destFolderPageId);
        const realParent = destNode?.parentFolderId === null ? null : destFolderPageId;
        d = {
          workspaceType: destKind === "projects-group" ? "Project" : "EducationOffering",
          workspaceId: wsId,
          root: null,
        };
        parent = realParent;
      } else {
        d = scopeDest(destScope, viewerId) as typeof d;
        parent = destFolderPageId ?? d.root;
      }

      // No-op if it's already there.
      if (destScopeId === sourceScopeId && (parent ?? null) === (item.parentFolderId ?? null)) return true;

      let res: Response;
      if (isPageItem(item)) {
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
      if (!res.ok) {
        const reason = await driveErrorFrom(res);
        if (reason) onError?.(reason);
      }
      return res.ok;
    },
    [driveScopes, viewerId],
  );
  const moveItemToScopeRef = useRef(moveItemToScope);
  moveItemToScopeRef.current = moveItemToScope;

  // Move a selection to another drive (or another folder of one): confirm a
  // change of audience, hide the rows, move them one by one, then report once.
  // Toasting per item stacked a notification (and fired a full tree revalidate)
  // for every file in the selection, and left as many single-item Undos as
  // there were items.
  const moveBatchToScope = useCallback(
    async (items: DriveItem[], sourceScopeId: string, destScopeId: string, destFolderId: string | null) => {
      if (isVirtualSpace(sourceScopeId) || isVirtualSpace(destScopeId)) {
        toast.error("Open the document to change where it lives");
        return;
      }
      const destScope = driveScopes.find((s) => s.id === destScopeId);
      if (!destScope) return;
      const destLabel = destScope.label;
      if (destScopeId !== sourceScopeId) {
        const ok = await dialog.confirm(
          items.length === 1
            ? {
                title: `Move to ${destLabel}?`,
                description: `"${items[0].title || "Untitled"}" will move to ${destLabel} and become visible to ${scopeAudience(destScopeId)}.`,
                confirmLabel: "Move",
              }
            : {
                title: `Move ${itemCount(items.length)}?`,
                description: `They'll move to ${destLabel} and become visible to ${scopeAudience(destScopeId)}.`,
                confirmLabel: "Move",
              },
        );
        if (!ok) return;
      }
      let failure: string | undefined;
      const landed = await runHiddenMoveBatch(
        items,
        (item) =>
          moveItemToScope(item, sourceScopeId, destScopeId, destFolderId, (message) => {
            failure ??= message;
          }),
        pendingHidden,
      );
      reportMoveBatch(
        { toast, history, revalidate },
        {
          landed,
          total: items.length,
          destination: destinationLabel(destScope, destFolderId),
          forward: (l: Landed<DriveItem>) =>
            moveItemToScopeRef.current(l.item, sourceScopeId, destScopeId, destFolderId),
          // A move out of My Drive is one-way: the endpoint refuses a Member
          // destination, so an Undo could only fail.
          back:
            scopeKindOf(sourceScopeId) === "mine"
              ? null
              : (l: Landed<DriveItem>) =>
                  moveItemToScopeRef.current(
                    { ...l.item, parentFolderId: destFolderId },
                    destScopeId,
                    sourceScopeId,
                    l.folderId,
                  ),
          failure: items.length === 1 ? failure : undefined,
        },
      );
    },
    [driveScopes, moveItemToScope, dialog, toast, history, revalidate, pendingHidden],
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
      const { drives, folders } = buildPickerRows(scopes);
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
      if (dest) await moveBatchToScope([item], sourceScopeId, dest.scopeId, dest.folderId);
    },
    [pickMoveDestination, moveBatchToScope],
  );

  // Bulk move: pick a destination once, move everything there, report once.
  const onBulkMove = useCallback(
    async (items: DriveItem[]) => {
      if (items.length === 0 || !effectiveScopeId) return;
      if (isVirtualSpace(effectiveScopeId)) {
        toast.error("Open the document to change where it lives");
        return;
      }
      const dest = await pickMoveDestination(items[0], effectiveScopeId, `Move ${itemCount(items.length)}`);
      if (dest) await moveBatchToScope(items, effectiveScopeId, dest.scopeId, dest.folderId);
    },
    [pickMoveDestination, moveBatchToScope, effectiveScopeId, toast],
  );

  // Cross-drive drag-and-drop: dropping an item onto a drive row (column-view
  // scope column) moves it to that drive's top level, confirming the re-scope.
  const onMoveToScope = useCallback(
    (sourceScopeId: string, destScopeId: string, items: DriveItem[]) => {
      if (items.length === 0) return;
      void moveBatchToScope(items, sourceScopeId, destScopeId, null);
    },
    [moveBatchToScope],
  );

  const getScopeActions = useCallback(
    (scopeId: string): RowActions => {
      const a = scopeActionsMap.get(scopeId);
      if (!a) return { onRename: () => {}, onRequestMove: () => {}, onDelete: () => {}, readOnly: isVirtualSpace(scopeId) };
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
      // Opening a folder drills into it within the Drive. Folders still carry a
      // `/documents/<id>` href (for move/share plumbing), so following it here
      // would render the folder Page as a document — the "managed folder opens
      // as a document" bug. Resolve the folder's owning scope and navigate the
      // Drive instead; the columns/breadcrumb state re-syncs from the URL.
      if (item.type === "folder") {
        const owner = driveScopes.find((s) => s.items.some((it) => it.id === item.id));
        onNavigate(owner?.id ?? effectiveScopeId, item.id);
        return;
      }
      navigate(item.href);
    },
    [navigate, driveScopes, onNavigate, effectiveScopeId],
  );

  const onOpenBeside = useOpenBeside();

  const onToggleFavorite = useCallback(
    async (item: DriveItem) => {
      if (item.type !== "doc" && item.type !== "folder" && item.type !== "form") return;
      await setPageFavorite(item.id, !item.favorited);
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
      if (!actions) {
        if (isVirtualSpace(effectiveScopeId)) toast.error("Open the document to delete it");
        return;
      }
      const confirmed = await dialog.confirm({
        title: `Delete ${items.length} item${items.length === 1 ? "" : "s"}?`,
        description: "Folders must be empty first.",
        tone: "destructive",
        confirmLabel: "Delete",
      });
      if (!confirmed) return;
      await runTrash({ items, deleteOne: actions.deleteItem, hiding: pendingHidden, history, toast, revalidate });
    },
    [effectiveScopeId, scopeActionsMap, dialog, toast, history, revalidate, pendingHidden],
  );

  // Upload for the current scope + folder. Called unconditionally (hook rule);
  // when at the Drive root the target defaults to Lab but the New menu (and thus
  // the upload item) isn't rendered there.
  function uploadTargetFor(folderId: string | null): UploadTarget {
    if (!currentScope) return { scope: { kind: "Lab" } };
    if (currentScope.id === "mine") return { scope: { kind: "Member" }, folderPageId: folderId };
    if (currentScope.id === "lab" || isProcessRootSpace(currentScope.id))
      return { scope: { kind: "Lab" }, folderPageId: folderId ?? currentScope.rootFolderId ?? null };
    if (currentScope.id === "projects" || currentScope.id === "education") {
      // Resolve the workspace from the folder. If we can't (e.g. at the
      // group root), fall back to Lab scope as a safe no-op.
      const workspaceId = resolveWorkspaceId(currentScope.items, folderId);
      if (!workspaceId) return { scope: { kind: "Lab" } };
      // If the folder IS the synthetic workspace folder, the real parent is null.
      const node = folderId ? currentScope.items.find((it) => it.id === folderId) : null;
      const realFolder = node?.parentFolderId === null ? null : folderId;
      // An offering is NOT a project. Sending its id as a projectId is what
      // made every upload into a course Drive fail — 403 for an instructor,
      // "Project not found" for Core.
      return currentScope.id === "education"
        ? { scope: { kind: "EducationOffering", offeringId: workspaceId }, folderPageId: realFolder }
        : { scope: { kind: "Project", projectId: workspaceId }, folderPageId: realFolder };
    }
    return { scope: { kind: "Project", projectId: currentScope.id }, folderPageId: folderId };
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const uploadTarget = useMemo(() => uploadTargetFor(currentFolderId), [currentScope, currentFolderId]);
  function uploadDestinationFor(folderId: string | null): UploadDestination | null {
    if (!currentScope) return null;
    const scopeId = currentScope.id;
    return {
      label: destinationLabel(currentScope, folderId),
      onOpen: () => onNavigate(scopeId, folderId),
    };
  }
  const { inputRef, uploading, uploadError, handleFileChange, uploadFiles } = useDriveFileUpload(
    uploadTarget,
    () => revalidator.revalidate(),
    uploadDestinationFor(currentFolderId),
  );
  function onDropFiles(files: File[], opts?: FileDropOptions) {
    const dropped = opts?.folderId ? uploadTargetFor(opts.folderId) : null;
    void uploadFiles(files, {
      ...(dropped
        ? {
            scope: dropped.scope,
            folderPageId: dropped.folderPageId ?? null,
            destination: uploadDestinationFor(opts!.folderId!),
          }
        : {}),
      skippedFolders: opts?.skippedFolders,
    });
  }

  const currentActions = effectiveScopeId ? scopeActionsMap.get(effectiveScopeId) : undefined;

  // Deep link from the desktop tray's "New document" quick action:
  // /drive?create=doc opens the New document flow in the current scope, then
  // strips the param so a refresh or Back doesn't reopen it. Waits for
  // currentActions (requires a resolved scope) rather than firing mount-only,
  // since a tray link with no scope yet selected has nothing to create into.
  const createDocHandledRef = useRef(false);
  useEffect(() => {
    if (createDocHandledRef.current) return;
    if (searchParams.get("create") !== "doc" || !currentActions) return;
    createDocHandledRef.current = true;
    void currentActions.createDoc();
    patchParams((p) => {
      p.delete("create");
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, currentActions]);

  // "From template" lands in the scope currently being browsed (project → that
  // project; Lab/Core → the Lab workspace, into the scoped root folder).
  // For the synthetic group scopes, resolve to the project being browsed.
  const templateTarget: TemplateTarget = useMemo(() => {
    if (!currentScope) return { targetWorkspaceType: "Lab" };
    const kind = scopeKindOf(currentScope.id);
    if (kind === "projects-group") {
      const projectId = resolveWorkspaceId(currentScope.items, currentFolderId);
      if (!projectId) return { targetWorkspaceType: "Lab" };
      const node = currentFolderId ? currentScope.items.find((it) => it.id === currentFolderId) : null;
      const realParent = node?.parentFolderId === null ? undefined : currentFolderId ?? undefined;
      return { targetWorkspaceType: "Project", targetWorkspaceId: projectId, targetParentPageId: realParent };
    }
    if (kind !== "project") {
      const parent = currentFolderId ?? currentScope.rootFolderId ?? undefined;
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

  const applyTag = useCallback(
    (id: string) => {
      if (!selectedTagIds.has(id)) toggleTag(id);
    },
    [selectedTagIds, toggleTag],
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

  // The active tags as removable chips. The picker itself is the compact
  // DriveTagFilter dropdown in the toolbar (below); this strip only shows what's
  // currently filtering, so it stays empty — and takes no vertical space — until
  // a tag is selected.
  const selectedTags = allTags.filter((t) => selectedTagIds.has(t.id));
  const tagChips =
    selectedTags.length > 0 ? (
      <div className="flex items-center gap-2 flex-wrap pb-1">
        <TagIcon className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        {selectedTags.map((tag) => (
          <button
            key={tag.id}
            type="button"
            onClick={() => toggleTag(tag.id)}
            aria-label={`Remove ${tag.label} filter`}
            className={cn(
              "inline-flex items-center gap-1 rounded-full border font-medium transition-colors",
              "px-3.5 py-1.5 text-sm",
              "border-os-accent bg-os-accent/15 text-os-accent hover:bg-os-accent/25",
            )}
          >
            {tag.label}
            <X className="w-3 h-3" />
          </button>
        ))}
        <button
          type="button"
          onClick={clearTags}
          className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground text-sm"
        >
          Clear
        </button>
      </div>
    ) : null;

  const caps = { canManageAgreements };
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
          buttonClassName={cn(filterPillClass(), "w-full sm:w-40")}
        />
      </div>
      {/* Scopes the term-aware spaces — Projects and Education. My Drive /
          General / Core are never term-bound. */}
      {terms.length > 0 && (
        <div data-testid="drive-term-filter">
          <TermFilter terms={terms} selected={selectedTerm} searchable />
        </div>
      )}
      {/* Multi-select tag filter. Shown only when the lab has tags — otherwise
          the pill would open onto an empty list. Selection lives in the URL
          (?tag=), shared with the removable chips under the toolbar. */}
      {allTags.length > 0 && (
        <div data-testid="drive-tag-filter">
          <DriveTagFilter
            tags={allTags}
            selectedIds={selectedTagIds}
            onToggle={toggleTag}
            onClear={clearTags}
          />
        </div>
      )}
    </>
  );

  // New is a fixture of the toolbar: at the drive chooser, where there is no
  // scope to create into, it greys out in place rather than leaving a hole that
  // shifts every control beside it once a drive is opened.
  const toolbarActions =
    currentScope && currentActions ? (
      <NewMenu
        scope={currentScope}
        actions={currentActions}
        canManageAgreements={canManageAgreements}
        onUploadClick={() => inputRef.current?.click()}
        uploading={uploading}
        onTemplate={() => setTemplatePickerOpen(true)}
        currentFolderId={currentFolderId}
        onCreated={onCreated}
      />
    ) : (
      <button
        type="button"
        disabled
        data-testid="drive-new-menu-disabled"
        title={
          effectiveScopeId && isVirtualSpace(effectiveScopeId)
            ? `Nothing can be created in ${driveScopes.find((s) => s.id === effectiveScopeId)?.label ?? "this space"}`
            : "Open a drive to create something"
        }
        className={cn(DRIVE_TOOLBAR_BTN, "cursor-not-allowed opacity-40")}
      >
        <Plus className="h-[18px] w-[18px]" strokeWidth={1.5} /> New
        <ChevronDown className="w-3.5 h-3.5 opacity-80" />
      </button>
    );

  // Templates and Trash are places you visit occasionally, not per-file
  // actions — they sit behind the toolbar's overflow menu rather than spending
  // two full-width pills on the row Drive's actual controls need.
  const overflowMenu = (
    <Menu
      align="right"
      ariaLabel="More Drive actions"
      trigger={
        <button
          type="button"
          data-testid="drive-more-menu"
          aria-label="More Drive actions"
          className={DRIVE_TOOLBAR_ICON_BTN}
        >
          <MoreHorizontal className="h-[18px] w-[18px]" strokeWidth={1.5} />
        </button>
      }
    >
      <Menu.Item
        icon={<LayoutTemplate className="w-3.5 h-3.5" />}
        onSelect={() => navigate("/drive/templates")}
      >
        <span data-testid="drive-templates-link">Templates</span>
      </Menu.Item>
      <Menu.Item
        icon={<Trash2 className="w-3.5 h-3.5" />}
        onSelect={() => setTrashOpen(true)}
      >
        <span data-testid="drive-trash-button">Trash</span>
      </Menu.Item>
    </Menu>
  );

  return (
    <DriveHistoryContext.Provider value={history}>
    <div className="w-full flex flex-col gap-4">
      {/* Drive used to treat its breadcrumb as the page title. That worked when
          no page had a title; under the design every hub opens with one, and a
          page that starts straight into a toolbar reads as a fragment of some
          other screen. The breadcrumb stays — it's navigation, and it carries
          the scope and folder the title can't. */}
      <header className="flex items-start justify-between gap-3 flex-wrap">
        {/* Inside a drive the title doubles as the way back out to the drive
            chooser — the Finder move of clicking the window's own title to step
            out of the volume. The breadcrumb starts at the drive itself, so
            without this a top-level folder listing had no click path back. */}
        <h1 className="font-heading text-4xl font-medium text-foreground">
          {effectiveScopeId && !isHiringLibrary ? (
            <button
              type="button"
              data-testid="drive-title-root"
              title="All drives"
              onClick={() => onNavigate(null, null)}
              className="transition-colors hover:text-os-accent"
            >
              Drive
            </button>
          ) : (
            (isHiringLibrary ? "Library" : "Drive")
          )}
        </h1>
      </header>
      {uploadError && <p className="text-sm text-destructive">{uploadError}</p>}

      <DriveBrowser
        scopes={visibleScopes}
        currentScopeId={effectiveScopeId}
        currentFolderId={currentFolderId}
        typeFilter={typeFilter}
        search={search}
        onSearchChange={onSearchChange}
        onNavigate={onNavigate}
        onHistory={(delta) => void navigate(delta)}
        initialSelectedId={initialSelectedId}
        revealId={revealId}
        onOpenItem={onOpenItem}
        onOpenBeside={onOpenBeside}
        onMove={onMove}
        getScopeActions={getScopeActions}
        onToggleFavorite={onToggleFavorite}
        onBulkDelete={onBulkDelete}
        onBulkMove={(items) => void onBulkMove(items)}
        onMoveToScope={onMoveToScope}
        onSharingChanged={() => revalidator.revalidate()}
        onUploadFiles={currentScope && !isVirtualSpace(currentScope.id) ? onDropFiles : undefined}
        filterControl={filterControl}
        newMenu={toolbarActions}
        overflowMenu={overflowMenu}
        tagChips={
          <>
            {tagChips}
          </>
        }
        tagFilter={tagFilter}
        onTagClick={applyTag}
        receiverViewer={{ isCore: canManageAgreements, isProjectMember: true }}
      />

      {/* Hidden upload input (driven by the New menu) + template picker modal */}
      <DriveUploadInput inputRef={inputRef} onChange={handleFileChange} />
      <TemplatePicker
        open={templatePickerOpen}
        onClose={() => setTemplatePickerOpen(false)}
        target={templateTarget}
      />

      {movePicker && (
        <FolderPicker
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

      {trashOpen && (
        <TrashPanel
          scopes={driveScopes}
          onNavigate={(scopeId, folderId) => {
            setTrashOpen(false);
            onNavigate(scopeId, folderId);
          }}
          onClose={() => setTrashOpen(false)}
          onRevalidate={() => revalidator.revalidate()}
          dialog={dialog}
          toast={toast}
        />
      )}
    </div>
    </DriveHistoryContext.Provider>
  );
}

// ── Trash panel ────────────────────────────────────────────────────────────────
