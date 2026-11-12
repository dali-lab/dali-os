import { FileText, ClipboardList, FileSignature, FolderOpen, Folder, Plus, ChevronDown, LayoutTemplate, Upload, Shapes, Presentation, NotebookPen } from "lucide-react";
import { useState, useRef } from "react";
import type { ReactNode } from "react";
import { DriveBrowser } from "~/components/drive/DriveBrowser";
import { DRIVE_TOOLBAR_BTN } from "~/components/drive/toolbar";
import { FolderPicker } from "~/components/drive/FolderPicker";
import { useDriveFileUpload } from "~/components/drive/useDriveFileUpload";
import { useDialog } from "~/components/ui/dialog";
import { useFeatureFlag } from "~/components/FeatureFlags";
import { useToast } from "~/components/ui/toast";
import { uploadEditorImage, uploadErrorMessage } from "~/components/doc/upload";
import { stashImport } from "~/components/slides/pptx/pending-import";
import { parsePptxFile, PPTX_ACCEPT, PptxImportError, uploadImages, validatePptxFile } from "~/components/slides/pptx/import-client";
import { Menu } from "~/components/ui/floating";
import { createNotebookRequest, sendJson } from "~/components/notebooks/notebook-requests";
import { NewDeckFromTemplate } from "~/components/slides/templates/NewDeckFromTemplate";
import { applyTemplateToDeck, type TemplateRow as SlideTemplateRow } from "~/components/slides/templates/templates-client";
import type { DriveScope } from "~/routes/drive.hub";
import { scopeKindOf, resolveWorkspaceId, educationCreateBlock, type ScopeActions } from "~/components/drive/scope-actions";

// The New ▾ button in the header. Creates into the current scope + folder via
// the scope's action factory; Lab adds form/agreement/template extras. Hidden
// at the Drive root (you pick a drive first).
// Disabled menu items can't show a tooltip, so the reason renders inline.
export function CreateLabel({
  testId,
  blockedReason,
  children,
}: {
  testId: string;
  blockedReason: string | null;
  children: ReactNode;
}) {
  return (
    <span data-testid={testId} className={blockedReason ? "flex flex-col opacity-60" : undefined}>
      {children}
      {blockedReason && <span className="text-xs text-muted-foreground">{blockedReason}</span>}
    </span>
  );
}

export type NotebookPlacement =
  | { kind: "ready"; workspaceType: "Lab" | "Project"; workspaceId: string | null; parentPageId: string | null }
  | { kind: "blocked"; reason: string }
  | { kind: "unavailable" };

/** Where a notebook created from this scope and folder lands. My Drive and Education cannot hold one. */
export function notebookPlacement(scope: DriveScope, currentFolderId: string | null): NotebookPlacement {
  const kind = scopeKindOf(scope.id);
  const parentPageId = currentFolderId ?? scope.rootFolderId ?? null;
  if (kind === "lab") return { kind: "ready", workspaceType: "Lab", workspaceId: null, parentPageId };
  if (kind === "project") return { kind: "ready", workspaceType: "Project", workspaceId: scope.id, parentPageId };
  if (kind === "projects-group") {
    const projectId = resolveWorkspaceId(scope.items, currentFolderId);
    if (!projectId) return { kind: "blocked", reason: "Open a project first" };
    const parentNode = scope.items.find((it) => it.id === currentFolderId);
    return {
      kind: "ready",
      workspaceType: "Project",
      workspaceId: projectId,
      parentPageId: parentNode?.parentFolderId === null ? null : currentFolderId,
    };
  }
  return { kind: "unavailable" };
}

export function NewMenu({
  scope,
  actions,
  canManageAgreements,
  onUploadClick,
  uploading,
  onTemplate,
  currentFolderId,
  onCreated,
}: {
  scope: DriveScope;
  actions: ScopeActions;
  canManageAgreements: boolean;
  onUploadClick: () => void;
  uploading: boolean;
  onTemplate: () => void;
  currentFolderId: string | null;
  onCreated: (id: string) => void;
}) {
  const isLab = scope.id === "lab";
  const label = scope.id === "mine" ? "My Drive" : isLab ? "Lab" : scope.label;
  const dialog = useDialog();
  const toast = useToast();
  const isEducation = scopeKindOf(scope.id) === "education-group";
  const docBlock = isEducation ? educationCreateBlock(scope.items, currentFolderId, "FreeForm") : null;
  const folderBlock = isEducation ? educationCreateBlock(scope.items, currentFolderId, "Folder") : null;
  const notebook = notebookPlacement(scope, currentFolderId);
  const slidesEnabled = useFeatureFlag("drive-slides");
  const slidesCollabEnabled = useFeatureFlag("slides-collab");
  const pptxInput = useRef<HTMLInputElement>(null);
  const [deckTemplatesOpen, setDeckTemplatesOpen] = useState(false);
  const templateProjectId = notebook.kind === "ready" && notebook.workspaceType === "Project" ? notebook.workspaceId : null;

  async function createSlidesFromTemplate(row: SlideTemplateRow) {
    setDeckTemplatesOpen(false);
    const id = await actions.createSlides(row.title);
    if (!id) return;
    const applied = await applyTemplateToDeck(id, row.id);
    if (!applied.ok) toast.error(applied.error);
    onCreated(id);
  }

  async function createSlidesFromPowerPoint(file: File) {
    const invalid = validatePptxFile(file);
    if (invalid) {
      toast.error(invalid);
      return;
    }
    const toastId = "slides-import";
    toast.info("Reading the PowerPoint file…", { id: toastId, duration: 0 });
    try {
      const plan = await parsePptxFile(file);
      const uploaded = await uploadImages(plan, (image) => uploadEditorImage(image), (done, total) =>
        toast.info(`Uploading images, ${done} of ${total}…`, { id: toastId, duration: 0 }),
      );
      const id = await actions.createSlides(file.name.replace(/\.pptx$/i, "").trim() || "Imported deck");
      if (!id) {
        toast.error("Couldn't create the slide deck.", { id: toastId });
        return;
      }
      if (!stashImport(id, { slides: uploaded.slides, skipped: uploaded.skipped })) {
        toast.error("The deck was created, but its slides were too large to carry over. Open it and choose Import slides.", { id: toastId });
      }
      onCreated(id);
    } catch (err) {
      toast.error(err instanceof PptxImportError ? err.message : uploadErrorMessage(err), { id: toastId });
    }
  }

  async function createNotebook() {
    if (notebook.kind !== "ready") return;
    const name = await dialog.prompt({
      title: "New notebook",
      label: "Name",
      defaultValue: "New notebook",
      confirmLabel: "Create",
      validate: (v) => (v.trim() ? null : "Enter a name"),
    });
    if (name === null) return;
    const created = await sendJson<{ id: string }>(
      createNotebookRequest({
        title: name,
        workspaceType: notebook.workspaceType,
        workspaceId: notebook.workspaceId,
        parentPageId: notebook.parentPageId,
      }),
    );
    if (created.ok && created.data) onCreated(created.data.id);
    else toast.error(created.error ?? "Couldn't create the notebook");
  }

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
    const folderPageId = currentFolderId ?? scope.rootFolderId ?? null;
    if (folderPageId) formData.set("folderPageId", folderPageId);
    const res = await fetch("/core/agreements", { method: "POST", body: formData, credentials: "include" });
    if (res.ok || res.redirected) {
      const driveUrl = res.url.replace(/\/core\/agreements\/([^/]+)$/, "/documents/agreement/$1");
      window.location.assign(driveUrl);
    }
  }

  async function createRubric() {
    const name = await dialog.prompt({
      title: "New rubric",
      label: "Name",
      defaultValue: "Untitled rubric",
      confirmLabel: "Create",
      validate: (v) => (v.trim() ? null : "Enter a name"),
    });
    if (name === null) return;
    const formData = new FormData();
    formData.set("name", name.trim());
    const folderPageId = currentFolderId ?? scope.rootFolderId ?? null;
    if (folderPageId) formData.set("folderPageId", folderPageId);
    const res = await fetch("/api/rubrics", { method: "POST", body: formData, credentials: "include" });
    const json = (await res.json().catch(() => ({}))) as { rubricId?: string };
    if (res.ok && json.rubricId) window.location.assign(`/hiring/rubrics/${json.rubricId}`);
    else toast.error("Couldn't create the rubric");
  }

  return (
    <>
    <input
      ref={pptxInput}
      type="file"
      accept={PPTX_ACCEPT}
      hidden
      aria-label="Choose a PowerPoint file"
      onChange={(e) => {
        const file = e.target.files?.[0];
        e.target.value = "";
        if (file) void createSlidesFromPowerPoint(file);
      }}
    />
    <NewDeckFromTemplate open={deckTemplatesOpen} projectId={templateProjectId} onPick={(row) => void createSlidesFromTemplate(row)} onClose={() => setDeckTemplatesOpen(false)} />
    <Menu
      align="right"
      ariaLabel={`New in ${label}`}
      trigger={
        <button
          type="button"
          data-testid={`drive-new-menu-${scope.id}`}
          className={DRIVE_TOOLBAR_BTN}
        >
          <Plus className="h-[18px] w-[18px]" strokeWidth={1.5} /> New
          <ChevronDown className="w-3.5 h-3.5 opacity-80" />
        </button>
      }
    >
      <Menu.Item
        icon={<FileText className="w-3.5 h-3.5" />}
        disabled={docBlock !== null}
        onSelect={() => void actions.createDoc()}
      >
        <CreateLabel testId={`drive-new-doc-${scope.id}`} blockedReason={docBlock}>
          New document
        </CreateLabel>
      </Menu.Item>
      <Menu.Item
        icon={<FolderOpen className="w-3.5 h-3.5" />}
        disabled={folderBlock !== null}
        onSelect={() => void actions.createFolder()}
      >
        <CreateLabel testId={`drive-new-folder-${scope.id}`} blockedReason={folderBlock}>
          New folder
        </CreateLabel>
      </Menu.Item>
      <Menu.Item
        icon={<Shapes className="w-3.5 h-3.5" />}
        disabled={docBlock !== null}
        onSelect={() => void actions.createWhiteboard()}
      >
        <CreateLabel testId={`drive-new-whiteboard-${scope.id}`} blockedReason={docBlock}>
          New whiteboard
        </CreateLabel>
      </Menu.Item>
      {slidesEnabled && (
        <Menu.Item
          icon={<Presentation className="w-3.5 h-3.5" />}
          disabled={docBlock !== null}
          onSelect={() => void actions.createSlides()}
        >
          <CreateLabel testId={`drive-new-slides-${scope.id}`} blockedReason={docBlock}>
            New slide deck
          </CreateLabel>
        </Menu.Item>
      )}
      {slidesEnabled && slidesCollabEnabled && (
        <Menu.Item
          icon={<Presentation className="w-3.5 h-3.5" />}
          disabled={docBlock !== null}
          onSelect={() => pptxInput.current?.click()}
        >
          <CreateLabel testId={`drive-new-slides-pptx-${scope.id}`} blockedReason={docBlock}>
            New deck from PowerPoint
          </CreateLabel>
        </Menu.Item>
      )}
      {slidesEnabled && slidesCollabEnabled && (
        <Menu.Item
          icon={<Presentation className="w-3.5 h-3.5" />}
          disabled={docBlock !== null}
          onSelect={() => setDeckTemplatesOpen(true)}
        >
          <CreateLabel testId={`drive-new-slides-template-${scope.id}`} blockedReason={docBlock}>
            New deck from template
          </CreateLabel>
        </Menu.Item>
      )}
      {notebook.kind !== "unavailable" && (
        <Menu.Item
          icon={<NotebookPen className="w-3.5 h-3.5" />}
          disabled={notebook.kind === "blocked"}
          onSelect={() => void createNotebook()}
        >
          <CreateLabel
            testId={`drive-new-notebook-${scope.id}`}
            blockedReason={notebook.kind === "blocked" ? notebook.reason : null}
          >
            New notebook
          </CreateLabel>
        </Menu.Item>
      )}
      <Menu.Item icon={<ClipboardList className="w-3.5 h-3.5" />} onSelect={() => void createForm()}>
        <span data-testid="drive-new-form">New form</span>
      </Menu.Item>
      {scope.id === "core" && canManageAgreements && (
        <Menu.Item icon={<FileSignature className="w-3.5 h-3.5" />} onSelect={() => void createAgreement()}>
          <span data-testid="drive-new-agreement">New agreement</span>
        </Menu.Item>
      )}
      {scope.id === "hiring" && canManageAgreements && (
        <Menu.Item icon={<ClipboardList className="w-3.5 h-3.5" />} onSelect={() => void createRubric()}>
          <span data-testid="drive-new-rubric">New rubric</span>
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
        <span data-testid={`drive-new-upload-${scope.id}`}>{uploading ? "Uploading…" : "Upload files"}</span>
      </Menu.Item>
    </Menu>
    </>
  );
}

// ── Hub shell ─────────────────────────────────────────────────────────────────
