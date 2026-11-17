import { useState, useEffect, useRef } from "react";
import { QuestionSourceNote } from "~/components/form-builder/QuestionSourceNote";
import { Link, useLoaderData, useFetcher, useSearchParams } from "react-router";
import {
  Plus,
  Pencil,
  FileText,
  Clock,
  UserIcon,
  Lock,
  Copy,
  Eye,
  Loader2,
  Trash2,
  ChevronDown,
  CornerDownRight,
  QrCode,
  Settings,
  Unlink,
  Undo2,
} from "lucide-react";
import { useConfirmSubmit, useDialog } from "~/components/ui/dialog";
import { useToast } from "~/components/ui/toast";
import { ResultsSwitch, resultsViewParams, type ResultsView } from "~/forms/components/ResultsControls";
import { PageBarTitle, PageBarMenuItems, PageBarPortal, pageBarTextButton } from "~/components/shell/page-bar-slot";
import { PageBarShareButton } from "~/components/shell/PageBarShareButton";
import { PageTitleHeader } from "~/components/doc-chrome/PageTitleHeader";
import { FormQrDialog } from "~/forms/components/FormQrDialog";
import type { HiringFormLink } from "~/forms/lib/form-links.server";
import { BADGE, FormBuilderTab } from "~/components/form-builder/FormBuilder";
import { InfoBody } from "~/components/form-builder/info-body";
import { isLayoutOnly } from "~/forms/lib/form-answers";
import { questionNumbers, ruleDepths, showIfSentence } from "~/forms/lib/form-logic";
import { FormPreviewModal } from "~/forms/components/FormPreviewModal";
import { ShareDialog } from "~/components/sharing/ShareDialog";
import { FormSettingsDialog } from "~/forms/components/FormSettings";
import { VersionResults } from "~/forms/components/VersionResults";
import { VersionSummary } from "~/forms/components/VersionSummary";
import { DocEditor } from "~/components/doc";
import { isEmptyBlocks } from "~/lib/blocks";
import { useDraftAutosave, type AutosaveStatus } from "~/forms/lib/use-draft-autosave";
import { Button } from "~/components/ui/Button";
import { Menu, Popover, Tooltip } from "~/components/ui/floating";
import type { Question } from "~/types";
import type { loader } from "~/forms/routes/forms.edit.$formId";
import { useUserTimeZone } from "~/hooks/useUserTimeZone";
import { formatInTimeZone } from "~/lib/timezone";
import { cn } from "~/lib/cn";
import { useOsChrome } from "~/components/os-chrome";
import { Z } from "~/components/ui/z";

function formatDateTime(iso: string, tz: string) {
  return (
    formatInTimeZone(iso, tz, { month: "short", day: "numeric", year: "numeric" }) +
    " at " +
    formatInTimeZone(iso, tz, { hour: "numeric", minute: "2-digit" })
  );
}

// Compact one-line form for the versions menu, e.g. "May 24, 11:49 AM".
function formatDateShort(iso: string, tz: string) {
  return (
    formatInTimeZone(iso, tz, { month: "short", day: "numeric" }) +
    ", " +
    formatInTimeZone(iso, tz, { hour: "numeric", minute: "2-digit" })
  );
}

type DraftPayload = { questions: Question[]; description: unknown };

function serializeDraft({ questions, description }: DraftPayload) {
  return JSON.stringify([questions, isEmptyBlocks(description) ? "" : description]);
}

type FormVersion = ReturnType<
  typeof useLoaderData<typeof loader>
>["form"]["versions"][number];

function nestingStyle(questions: Question[], q: Question) {
  const depth = ruleDepths(questions).get(q.key) ?? 0;
  return depth > 0 ? { marginLeft: depth * 32 } : undefined;
}

// Editor page for a single form. A top bar (name, versions, settings, preview,
// share, publish) over either the builder — component library on the left,
// canvas on the right — or a selected version, shown as its questions or its
// results. Results belong to the version they were collected on.
//
// The draft autosaves as the builder changes (save-draft). It is NOT usable:
// published fills always serve the latest frozen version, never the draft.
// Publish freezes the draft into an immutable version (save-version).
export function FormDetail() {
  const { form, terms, mappedQuestions, fillers, usages, managing, hiringLinks: rawHiringLinks, collabToken, results, summary, tracker, page } = useLoaderData<typeof loader>();
  // The staffing slot binding, if any: {{term}} in this form's questions
  // resolves from it (see FormBuilderTab's termBinding).
  const staffingBinding = usages.find((u) => u.kind === "staffing") ?? null;
  const hiringLinks: HiringFormLink[] = rawHiringLinks ?? [];
  const tz = useUserTimeZone();
  const saveFetcher = useFetcher<{ ok?: boolean; error?: string }>();
  const publishingEdits = saveFetcher.state !== "idle";
  const saveError =
    saveFetcher.data && "error" in saveFetcher.data ? saveFetcher.data.error : null;
  const draftFetcher = useFetcher<{ ok?: boolean; error?: string }>();
  const discardFetcher = useFetcher<{ ok?: boolean; error?: string }>();
  const dialog = useDialog();
  const toast = useToast();
  const renameFetcher = useFetcher();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);

  // Deleting a not-yet-used version (accidental-versioning cleanup). Guarded by
  // a confirm dialog; the server re-checks the lock before deleting.
  const deleteFetcher = useFetcher<{ ok?: boolean; error?: string }>();
  const confirmSubmit = useConfirmSubmit();
  const deleteError =
    deleteFetcher.data && "error" in deleteFetcher.data
      ? deleteFetcher.data.error
      : null;

  const latestVersion = form.versions.length
    ? form.versions[form.versions.length - 1]
    : null;
  const hasDraft = form.draft != null;
  const hasEmailQuestion = (latestVersion?.questions ?? []).some((q) => q.type === "email");

  // A version's results view lives in the URL (`?view=results&version=N`) so
  // the loader can fetch that version's responses and links can deep-link.
  const [searchParams, setSearchParams] = useSearchParams();
  const view = searchParams.get("view") === "results" ? "results" : "questions";
  const showSummary = searchParams.get("show") !== "responses";

  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(
    () =>
      (view === "results"
        ? form.versions.find(
            (v) => String(v.versionNumber) === searchParams.get("version"),
          )?.id
        : undefined) ??
      latestVersion?.id ??
      null,
  );
  // Open straight into the builder when there's a draft to resume or no
  // version exists yet; otherwise land on the latest version's preview.
  const [isEditing, setIsEditing] = useState(
    view !== "results" && (hasDraft || form.versions.length === 0),
  );

  function showVersion(id: string, nextView: "questions" | "results") {
    setSelectedVersionId(id);
    setIsEditing(false);
    const version = form.versions.find((v) => v.id === id);
    if (nextView === "results" && version) {
      setSearchParams(
        { view: "results", version: String(version.versionNumber) },
        { replace: true, preventScrollReset: true },
      );
    } else if (searchParams.has("view")) {
      setSearchParams({}, { replace: true, preventScrollReset: true });
    }
  }

  const selectedVersion = form.versions.find(
    (v) => v.id === selectedVersionId,
  );

  // Seed the builder: resume the draft if present, else duplicate the version
  // the user chose to branch from, else start blank.
  const [seed, setSeed] = useState<{
    questions: Question[];
    description: unknown;
  }>(() =>
    form.draft
      ? { questions: form.draft.questions, description: form.draft.description }
      : latestVersion
        ? { questions: latestVersion.questions, description: latestVersion.description }
        : { questions: [], description: null },
  );

  // After a save-version round-trips and the loader re-runs (version count
  // grows, draft cleared), select the new version and leave edit mode.
  const prevCount = useRef(form.versions.length);
  useEffect(() => {
    if (form.versions.length > prevCount.current) {
      setSelectedVersionId(form.versions[form.versions.length - 1].id);
      setIsEditing(false);
    }
    prevCount.current = form.versions.length;
  }, [form.versions.length]);

  // If the selected version disappears (deleted in place), fall back to the
  // latest so the right pane doesn't show the empty state while versions exist.
  useEffect(() => {
    if (
      selectedVersionId &&
      !form.versions.some((v) => v.id === selectedVersionId)
    ) {
      setSelectedVersionId(latestVersion?.id ?? null);
    }
  }, [form.versions, selectedVersionId, latestVersion?.id]);

  // A monotonic key for the builder. Bumped only when we deliberately re-seed
  // (startEditing) so the builder remounts then — NOT on every loader
  // revalidation (e.g. after a draft save flips hasDraft), which would wipe the
  // user's in-progress edits and the "Saved" flash.
  const [editKey, setEditKey] = useState(0);

  // Set to open FormPreviewModal, showing what the form would look like once
  // published — either the builder's live in-progress state or a saved
  // version's frozen questions, depending on which "Preview" button was used.
  // `reference` questions only store a source key, so the modal can't render
  // their option cards until forms/preview-resolve fills them in — the button
  // stays in a loading state until that round-trip lands.
  const [previewData, setPreviewData] = useState<{
    questions: Question[];
    description: unknown;
    prefill?: Record<string, string>;
  } | null>(null);
  const previewFetcher = useFetcher<
    { ok: true; questions: Question[]; prefill?: Record<string, string> } | { error: string }
  >();
  const previewPendingDescription = useRef<unknown>(null);
  function requestPreview(payload: { questions: Question[]; description: unknown }) {
    previewPendingDescription.current = payload.description;
    const fd = new FormData();
    fd.set("questions", JSON.stringify(payload.questions));
    fd.set("formId", form.id);
    previewFetcher.submit(fd, { method: "post", action: "/forms/preview-resolve" });
  }
  useEffect(() => {
    const data = previewFetcher.data;
    if (data && "questions" in data) {
      setPreviewData({
        questions: data.questions,
        description: previewPendingDescription.current,
        prefill: data.prefill,
      });
    }
  }, [previewFetcher.data]);
  const previewResolving = previewFetcher.state !== "idle";

  function blankSeed() {
    return latestVersion
      ? { questions: latestVersion.questions, description: latestVersion.description }
      : { questions: [], description: null };
  }

  const autosave = useDraftAutosave<DraftPayload>({
    send: (payload) => {
      const fd = new FormData();
      fd.set("intent", "save-draft");
      fd.set("id", form.id);
      fd.set("questions", JSON.stringify(payload.questions));
      fd.set("description", isEmptyBlocks(payload.description) ? "" : JSON.stringify(payload.description));
      draftFetcher.submit(fd, { method: "post" });
    },
    busy: draftFetcher.state !== "idle",
    result: draftFetcher.data,
    serialize: serializeDraft,
    baseline: seed,
  });

  useEffect(() => {
    if (!isEditing) return;
    return () => void autosave.flush();
  }, [isEditing, editKey]);

  // Open the builder and switch to it, seeded from (in order): an explicit
  // source version, the resumable draft, the latest frozen version (so "New
  // version" carries the current questions forward to add to), else blank.
  function startEditing(from?: DraftPayload) {
    if (searchParams.has("view")) {
      setSearchParams({}, { replace: true, preventScrollReset: true });
    }
    const next = from ?? form.draft ?? blankSeed();
    setSeed(next);
    autosave.reset(next);
    setEditKey((k) => k + 1);
    setIsEditing(true);
  }

  function editVersion(version: (typeof form.versions)[number]) {
    startEditing(
      hasDraft ? undefined : { questions: version.questions, description: version.description },
    );
  }

  async function publishEdits() {
    await autosave.flush();
    const snapshot = builderSnapshot.current?.();
    if (!snapshot) return;
    const fd = new FormData();
    fd.set("id", form.id);
    fd.set("intent", "save-version");
    fd.set("publish", "true");
    fd.set("questions", JSON.stringify(snapshot.questions));
    fd.set("description", isEmptyBlocks(snapshot.description) ? "" : JSON.stringify(snapshot.description));
    saveFetcher.submit(fd, { method: "post" });
  }

  async function discardDraft() {
    const confirmed = await dialog.confirm({
      title: "Discard this draft?",
      description: "Your unpublished changes are deleted. The live version stays as it is.",
      confirmLabel: "Discard draft",
      tone: "destructive",
    });
    if (!confirmed) return;
    await autosave.flush();
    autosave.reset(blankSeed());
    discardFetcher.submit({ intent: "discard-draft", id: form.id }, { method: "post" });
  }

  useEffect(() => {
    if (discardFetcher.state !== "idle" || !discardFetcher.data?.ok) return;
    if (form.versions.length > 0) {
      setIsEditing(false);
    } else {
      const next = blankSeed();
      setSeed(next);
      setEditKey((k) => k + 1);
    }
  }, [discardFetcher.state, discardFetcher.data]);

  const busySaving = publishingEdits;
  const builderSnapshot = useRef<
    (() => { questions: Question[]; description: unknown }) | null
  >(null);

  function preview() {
    if (isEditing && builderSnapshot.current) {
      requestPreview(builderSnapshot.current());
    } else if (selectedVersion) {
      requestPreview({
        questions: selectedVersion.questions,
        description: selectedVersion.description,
      });
    }
  }

  const nextVersionNumber = (latestVersion?.versionNumber ?? 0) + 1;
  const autosaveSuffix =
    autosave.status === "saving" ? " · Saving…" : autosave.status === "saved" ? " · Saved" : "";
  const statusLabel = isEditing
    ? `Editing v${nextVersionNumber} draft${autosaveSuffix}`
    : selectedVersion
      ? `v${selectedVersion.versionNumber}${
          selectedVersion.id === latestVersion?.id && !managing
            ? ` · ${form.published ? "Published" : "Not published"}`
            : ""
        }`
      : "Versions";

  const resultsView: ResultsView = view === "results" ? (showSummary ? "summary" : "responses") : "questions";
  const lead = selectedVersion ? (
    <ResultsSwitch
      view={resultsView}
      responseCount={selectedVersion.submissionCount}
      byline={`v${selectedVersion.versionNumber} · published by ${selectedVersion.createdByName}, ${formatInTimeZone(
        selectedVersion.createdAt,
        tz,
        { month: "short", day: "numeric", year: "numeric" },
      )}`}
      onChange={(next) => {
        setIsEditing(false);
        setSearchParams(resultsViewParams(searchParams, next, selectedVersion.versionNumber), {
          replace: true,
          preventScrollReset: true,
        });
      }}
    />
  ) : null;

  const fillUrl =
    form.published && form.publicToken
      ? `${typeof window !== "undefined" ? window.location.origin : ""}/forms/fill/${form.publicToken}`
      : null;
  const publishToggle = usePublishToggle({ formId: form.id, published: form.published, inUse: usages.length > 0 });

  async function copyFillLink() {
    if (!fillUrl) return;
    try {
      await navigator.clipboard.writeText(fillUrl);
      toast.success("Link copied.");
    } catch {
      toast.error("Couldn't copy the link.");
    }
  }

  const [icon, setIcon] = useState(form.iconEmoji ?? null);
  const rename = (name: string) => renameFetcher.submit({ intent: "rename-form", id: form.id, name }, { method: "post" });
  useEffect(() => setIcon(form.iconEmoji ?? null), [form.iconEmoji]);
  const iconFetcher = useFetcher();

  const primary = isEditing ? (
    <Tooltip
      content={
        managing
          ? "Save your changes as a new version. The managing feature uses the latest one."
          : "Save your changes as a new version and make it live at the share link."
      }
    >
      <Button variant="primary" size="sm" disabled={busySaving} onClick={() => void publishEdits()}>
        {publishingEdits ? "Publishing…" : "Publish"}
      </Button>
    </Tooltip>
  ) : managing ? null : !form.published && form.versions.length > 0 ? (
    <Tooltip content={publishToggle.error ?? "Make the latest version live at the share link."} placement="bottom">
      <Button variant="primary" size="sm" disabled={publishToggle.busy} onClick={() => void publishToggle.toggle()}>
        {publishToggle.busy ? "Saving…" : "Publish"}
      </Button>
    </Tooltip>
  ) : form.published && selectedVersion ? (
    <Button variant="primary" size="sm" onClick={() => startEditing()}>
      {hasDraft ? <Pencil className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
      {hasDraft ? "Continue editing draft" : "New version"}
    </Button>
  ) : null;

  return (
    <div className="space-y-6">
      <PageBarTitle title={form.name} onRename={rename} emoji={icon} />
      <PageTitleHeader
        title={form.name}
        iconEmoji={icon}
        canEdit
        onRename={rename}
        onIconChange={(next) => {
          setIcon(next);
          iconFetcher.submit({ intent: "set-form-icon", id: form.id, iconEmoji: next ?? "" }, { method: "post" });
        }}
      />
      <PageBarPortal slot="status">
        <div className="flex items-center gap-2">
          <FormVersionMenu
            formId={form.id}
            versions={form.versions}
            draftQuestionCount={hasDraft ? (form.draft?.questions.length ?? 0) : null}
            currentLabel={statusLabel}
            selectedVersionId={isEditing ? null : (selectedVersionId ?? null)}
            editingDraft={isEditing}
            tz={tz}
            onOpenDraft={() => startEditing()}
            onNewVersion={() => startEditing()}
            onSelect={(v) => showVersion(v.id, "questions")}
            onResults={(v) => showVersion(v.id, "results")}
            onEdit={(v) => editVersion(v)}
            deleteFetcher={deleteFetcher}
            confirmSubmit={confirmSubmit}
          />
          {isEditing && autosave.status === "error" && <DraftStatus status={autosave.status} onRetry={autosave.retry} />}
        </div>
      </PageBarPortal>
      <PageBarPortal slot="actions">
        <button
          type="button"
          onClick={preview}
          disabled={previewResolving || (!isEditing && !selectedVersion)}
          className={cn(pageBarTextButton(), "disabled:opacity-40")}
        >
          {previewResolving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
          Preview
        </button>
        {!managing && (
          <>
            {fillUrl ? (
              <button type="button" onClick={() => void copyFillLink()} className={pageBarTextButton()}>
                <Copy className="h-4 w-4" />
                Copy form link
              </button>
            ) : (
              <Tooltip content="Publish to get a link">
                <span>
                  <button type="button" disabled className={cn(pageBarTextButton(), "opacity-40")}>
                    <Copy className="h-4 w-4" />
                    Copy form link
                  </button>
                </span>
              </Tooltip>
            )}
            <PageBarShareButton onClick={() => setShareOpen(true)} />
          </>
        )}
        {managing && (
          <Tooltip content="This feature decides who can fill the form and when, so publishing and sharing happen there.">
            {managing.href ? (
              <Link to={managing.href} className={pageBarTextButton()}>
                <Lock className="h-4 w-4" />
                Managed by {managing.label}
              </Link>
            ) : (
              <span className={pageBarTextButton()}>
                <Lock className="h-4 w-4" />
                Managed by {managing.label}
              </span>
            )}
          </Tooltip>
        )}
        {primary}
      </PageBarPortal>
      <PageBarMenuItems>
        <Menu.Item icon={<Settings className="h-3.5 w-3.5" />} onSelect={() => setSettingsOpen(true)}>
          Form settings
        </Menu.Item>
        {fillUrl && !managing && (
          <Menu.Item icon={<QrCode className="h-3.5 w-3.5" />} onSelect={() => setQrOpen(true)}>
            QR code
          </Menu.Item>
        )}
        {form.published && !managing && (
          <Menu.Item icon={<Unlink className="h-3.5 w-3.5" />} onSelect={() => void publishToggle.toggle()}>
            Unpublish
          </Menu.Item>
        )}
        {hasDraft && (
          <Menu.Item icon={<Undo2 className="h-3.5 w-3.5" />} onSelect={() => void discardDraft()}>
            Discard draft
          </Menu.Item>
        )}
      </PageBarMenuItems>
      <FormSettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        managing={managing}
        usages={usages}
        hiringLinks={hiringLinks}
        formId={form.id}
        oneResponsePerMember={form.oneResponsePerMember}
        allowResponseEdit={form.allowResponseEdit}
        remindBeforeClose={form.remindBeforeClose}
        confirmationMessage={form.confirmationMessage}
        sendReceipt={form.sendReceipt}
        audience={form.audience}
        hasEmailQuestion={hasEmailQuestion}
        notifyOnSubmission={form.notifyOnSubmission}
        listed={form.listed}
        opensAt={form.opensAt}
        closesAt={form.closesAt}
      />
      {!managing && (
        <ShareDialog
          page={{ id: form.id, title: form.name, workspaceType: page.workspaceType ?? "Lab" }}
          open={shareOpen}
          onClose={() => setShareOpen(false)}
          fillUrl={fillUrl}
        />
      )}
      {fillUrl && (
        <FormQrDialog open={qrOpen} onClose={() => setQrOpen(false)} fillUrl={fillUrl} formName={form.name} />
      )}

      {(deleteError || saveError) && (
        <p className="text-sm text-destructive">{deleteError ?? saveError}</p>
      )}

      {isEditing ? (
        <FormBuilderTab
          // Tells the question editor what {{term}} resolves to here, and
          // warns when the form drives no slot so the token can't resolve.
          termBinding={staffingBinding}
          // Remount only on a deliberate re-seed (startEditing bumps
          // editKey), so a draft save's revalidation doesn't blow away
          // in-progress edits. FormBuilderTab reads its initial* props
          // only on mount.
          key={editKey}
          formId={form.id}
          collabToken={collabToken ?? null}
          initialQuestions={seed.questions}
          initialDescription={seed.description}
          terms={terms}
          mappedQuestions={mappedQuestions}
          fillers={fillers}
          allowCheckbox
          onChange={autosave.schedule}
          snapshotRef={builderSnapshot}
        />
      ) : selectedVersion ? (
        <div className="space-y-4">
          {view !== "results" && lead}

          {view === "results" && showSummary ? (
            summary && summary.versionId === selectedVersion.id ? (
              <VersionSummary
                key={selectedVersion.id}
                formId={form.id}
                versionNumber={selectedVersion.versionNumber}
                data={summary}
                tracker={tracker}
                lead={lead}
                totalCount={selectedVersion.submissionCount}
              />
            ) : (
              <>
                {lead}
                <div className="py-12 flex justify-center">
                  <Loader2 className="w-5 h-5 animate-spin text-os-grey" />
                </div>
              </>
            )
          ) : view === "results" ? (
            results && results.versionId === selectedVersion.id ? (
              <VersionResults
                key={selectedVersion.id}
                formId={form.id}
                versionNumber={selectedVersion.versionNumber}
                results={results}
                tracker={tracker}
                lead={lead}
              />
            ) : (
              <>
                {lead}
                <div className="py-12 flex justify-center">
                  <Loader2 className="w-5 h-5 animate-spin text-os-grey" />
                </div>
              </>
            )
          ) : (
            <div className="rounded-os-card bg-os-card p-5 space-y-4">
              {!isEmptyBlocks(selectedVersion.description) && (
                <div className="px-4 py-3 rounded-os-item bg-os-well">
                  {/* Keyed per version: DocEditor reads initialContent once,
                      so switching versions must remount it. */}
                  <DocEditor
                    key={selectedVersion.id}
                    features="notes"
                    density="compact"
                    editable={false}
                    initialContent={selectedVersion.description}
                  />
                </div>
              )}
              {selectedVersion.questions.map((q, index) => (
                <Tooltip key={q.key} content={hasDraft ? "Continue editing draft" : "Edit in a new version"}>
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => startEditing()}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        startEditing();
                      }
                    }}
                    className="relative p-4 rounded-os-item border border-os-container cursor-pointer transition-colors hover:border-os-container-hi hover:bg-os-well/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-os-accent"
                    style={nestingStyle(selectedVersion.questions, q)}
                  >
                    {nestingStyle(selectedVersion.questions, q) && (
                      <CornerDownRight aria-hidden className="absolute -left-7 top-4 w-[18px] h-[18px] text-os-accent" />
                    )}
                    {q.type === "info" ? (
                      <div className="text-sm text-muted-foreground">
                        <InfoBody body={q.data.body} />
                      </div>
                    ) : (
                    <div className="flex items-center gap-3 mb-1 flex-wrap">
                      {q.type === "pageBreak" ? (
                        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          Page break
                        </span>
                      ) : (
                        <span className="text-sm font-medium text-muted-foreground">
                          Q{selectedVersion.questions.slice(0, index + 1).filter((qq) => !isLayoutOnly(qq.type)).length}
                        </span>
                      )}
                      <h4 className="text-base font-medium text-foreground">
                        {q.data.label}
                      </h4>
                      {q.required && (
                        <span className={BADGE.accent}>
                          Required
                        </span>
                      )}
                    </div>
                    )}
                    {q.data.description && (
                      <p className="text-sm text-muted-foreground mb-2">
                        {q.data.description}
                      </p>
                    )}
                    {q.data.showIf && (
                      <p className="text-sm text-os-accent mb-2">
                        Shown when {showIfSentence(q.data.showIf, questionNumbers(selectedVersion.questions), selectedVersion.questions)}
                      </p>
                    )}
                    <QuestionSourceNote question={q} />
                    {(q.type === "select" ||
                      q.type === "radio" ||
                      q.type === "skills_rating" ||
                      q.type === "checkbox") &&
                      q.data.options && (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {[...q.data.options, ...(q.data.allowOther ? ["Other"] : [])].map((opt) => (
                            <span
                              key={opt}
                              className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-os-well text-os-grey border border-os-container"
                            >
                              {opt}
                            </span>
                          ))}
                        </div>
                      )}
                    {q.type === "scale" && (q.data.scaleLow || q.data.scaleHigh) && (
                      <p className="text-xs text-muted-foreground mt-1">
                        1 to 5: {[q.data.scaleLow, q.data.scaleHigh].filter(Boolean).join(" to ")}
                      </p>
                    )}
                    {q.type === "number" &&
                      (q.data.min !== undefined || q.data.max !== undefined) && (
                        <p className="text-xs text-muted-foreground mt-1">
                          {q.data.min !== undefined && `Min ${q.data.min}`}
                          {q.data.min !== undefined && q.data.max !== undefined && ", "}
                          {q.data.max !== undefined && `Max ${q.data.max}`}
                        </p>
                      )}
                    {q.type === "file" && q.data.accept && (
                      <p className="text-xs text-muted-foreground mt-1">
                        Accepts: {q.data.accept}
                      </p>
                    )}
                  </div>
                </Tooltip>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="text-center py-12 rounded-os-card bg-os-card">
          <FileText className="mx-auto h-12 w-12 text-muted-foreground/70" />
          <h3 className="mt-2 text-sm font-medium text-foreground">No versions</h3>
          <div className="mt-6">
            <Button variant="primary" size="sm" onClick={() => startEditing()}>
              <Plus className="w-4 h-4" />
              Build form
            </Button>
          </div>
        </div>
      )}

      {previewData && (
        <FormPreviewModal
          formId={form.id}
          formName={form.name}
          iconEmoji={form.iconEmoji}
          description={previewData.description}
          confirmationMessage={form.confirmationMessage}
          questions={previewData.questions}
          prefill={previewData.prefill}
          onClose={() => setPreviewData(null)}
        />
      )}
    </div>
  );
}

function DraftStatus({ status, onRetry }: { status: AutosaveStatus; onRetry: () => void }) {
  if (status === "error") {
    return (
      <button
        type="button"
        onClick={onRetry}
        className="text-sm text-os-amber hover:underline"
      >
        Couldn't save · Retry
      </button>
    );
  }
  if (status === "saving") return <span className="text-sm text-os-grey">Saving…</span>;
  if (status === "saved") return <span className="text-sm text-os-grey">Saved</span>;
  return null;
}

// The clock button: the draft, every saved version (newest first) with its
// response count, and in-place edit/delete for versions nobody has used yet.
function FormVersionMenu({
  formId,
  versions,
  draftQuestionCount,
  currentLabel,
  selectedVersionId,
  editingDraft,
  tz,
  onOpenDraft,
  onNewVersion,
  onSelect,
  onResults,
  onEdit,
  deleteFetcher,
  confirmSubmit,
}: {
  formId: string;
  versions: FormVersion[];
  draftQuestionCount: number | null;
  currentLabel: string;
  selectedVersionId: string | null;
  editingDraft: boolean;
  tz: string;
  onOpenDraft: () => void;
  onNewVersion: () => void;
  onSelect: (v: FormVersion) => void;
  onResults: (v: FormVersion) => void;
  onEdit: (v: FormVersion) => void;
  deleteFetcher: ReturnType<typeof useFetcher<{ ok?: boolean; error?: string }>>;
  confirmSubmit: ReturnType<typeof useConfirmSubmit>;
}) {
  const { popover } = useOsChrome();
  const latestId = versions[versions.length - 1]?.id;
  const rowClass = (active: boolean) =>
    cn(
      "w-full text-left px-3 py-2.5 rounded-os-item transition-colors",
      active ? "bg-os-accent/15" : "hover:bg-os-container",
    );
  return (
    <Popover
      align="right"
      ariaLabel="Versions"
      panelClassName={cn(
        `${Z.popover} w-80 max-w-[calc(100vw-2rem)] overflow-y-auto overflow-x-hidden p-2 focus:outline-none`,
        popover,
      )}
      trigger={
        <button type="button" className={pageBarTextButton()}>
          {currentLabel}
          <ChevronDown className="h-3.5 w-3.5" />
        </button>
      }
    >
      {(close) => (
        <div className="flex flex-col gap-1">
          {draftQuestionCount !== null ? (
            <button
              type="button"
              onClick={() => {
                onOpenDraft();
                close();
              }}
              className={rowClass(editingDraft)}
            >
              <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <Pencil className="w-3.5 h-3.5 text-os-accent" />
                Draft
              </div>
              <div className="text-xs text-os-grey mt-0.5">
                {draftQuestionCount} {draftQuestionCount === 1 ? "question" : "questions"} · saved automatically
              </div>
            </button>
          ) : (
            versions.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  onNewVersion();
                  close();
                }}
                className={cn(rowClass(false), "flex items-center gap-2 text-sm font-semibold text-foreground")}
              >
                <Plus className="w-4 h-4 text-os-accent" />
                New version
              </button>
            )
          )}
          {versions.length > 0 && <div className="h-px bg-os-container my-1" />}
          {versions.length === 0 && (
            <p className="px-3 py-2 text-sm text-os-grey">No versions yet.</p>
          )}
          {[...versions].reverse().map((v) => (
            <div key={v.id} className={cn(rowClass(v.id === selectedVersionId), "group")}>
              <button
                type="button"
                onClick={() => {
                  onSelect(v);
                  close();
                }}
                className="w-full text-left"
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-foreground">
                    v{v.versionNumber}
                  </span>
                  {v.id === latestId && (
                    <span className={BADGE.accent}>
                      Live
                    </span>
                  )}
                  <span className="text-xs text-os-grey">
                    {v.questions.length} {v.questions.length === 1 ? "question" : "questions"}
                  </span>
                </div>
                <div className="mt-1 flex items-center gap-3 text-xs text-os-grey">
                  <span className="inline-flex items-center gap-1 min-w-0">
                    <Clock className="w-3 h-3 shrink-0" />
                    <span className="truncate">{formatDateShort(v.createdAt, tz)}</span>
                  </span>
                  <span className="inline-flex items-center gap-1 min-w-0">
                    <UserIcon className="w-3 h-3 shrink-0" />
                    <span className="truncate">{v.createdByName}</span>
                  </span>
                </div>
              </button>
              <div className="mt-2 flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    onResults(v);
                    close();
                  }}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-os-container text-foreground hover:bg-os-container-hi transition-colors"
                >
                  Results
                  <span className="tabular-nums opacity-70">{v.submissionCount}</span>
                </button>
                <Tooltip content="Edit in a draft">
                  <button
                    type="button"
                    onClick={() => {
                      onEdit(v);
                      close();
                    }}
                    aria-label={`Edit v${v.versionNumber}`}
                    className="ml-auto p-1.5 rounded-full text-os-grey hover:bg-os-container-hi hover:text-foreground"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                </Tooltip>
                {!v.locked && (
                  <>
                    <deleteFetcher.Form
                      method="post"
                      onSubmit={confirmSubmit({
                        title: `Delete v${v.versionNumber}?`,
                        description:
                          "This version has no responses yet. Deleting it can't be undone.",
                        confirmLabel: "Delete",
                        tone: "destructive",
                      })}
                    >
                      <input type="hidden" name="intent" value="delete-version" />
                      <input type="hidden" name="id" value={formId} />
                      <input type="hidden" name="versionId" value={v.id} />
                      <Tooltip content="Delete version">
                        <button
                          type="submit"
                          aria-label={`Delete v${v.versionNumber}`}
                          className="p-1.5 rounded-full text-os-grey hover:bg-destructive/10 hover:text-destructive"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </Tooltip>
                    </deleteFetcher.Form>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </Popover>
  );
}

function usePublishToggle({ formId, published, inUse }: { formId: string; published: boolean; inUse: boolean }) {
  const fetcher = useFetcher<{ error?: string }>();
  const dialog = useDialog();

  async function toggle() {
    if (
      published &&
      inUse &&
      !(await dialog.confirm({
        title: "Unpublish this form?",
        tone: "destructive",
        description: "It's in use elsewhere. Unpublishing hides it there until you publish again.",
        confirmLabel: "Unpublish",
      }))
    ) {
      return;
    }
    fetcher.submit({ intent: published ? "unpublish-form" : "publish-form", id: formId }, { method: "post" });
  }

  return { toggle, busy: fetcher.state !== "idle", error: fetcher.data?.error ?? null };
}
