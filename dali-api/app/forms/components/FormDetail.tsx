import { useState, useEffect, useRef } from "react";
import { Link, useLoaderData, useFetcher, useSearchParams } from "react-router";
import {
  Plus,
  Pencil,
  FileText,
  Clock,
  UserIcon,
  Lock,
  Copy,
  Check,
  Eye,
  Loader2,
  Trash2,
  History,
  ChevronDown,
  Share2,
} from "lucide-react";
import { useConfirmSubmit, useDialog } from "~/components/ui/dialog";
import type { HiringFormLink } from "~/hiring/lib/form-links.server";
import { BADGE, FormBuilderTab } from "~/components/form-builder/FormBuilder";
import { FormPreviewModal } from "~/forms/components/FormPreviewModal";
import { FormSettingsButton } from "~/forms/components/FormSettings";
import { VersionResults } from "~/forms/components/VersionResults";
import { DocEditor } from "~/components/doc";
import { isEmptyBlocks } from "~/lib/blocks";
import { Button } from "~/components/ui/Button";
import { Popover, Tooltip } from "~/components/ui/floating";
import type { Question } from "~/types";
import type { loader } from "~/forms/routes/forms.edit.$formId";
import { useUserTimeZone } from "~/hooks/useUserTimeZone";
import { formatInTimeZone } from "~/lib/timezone";
import { cn } from "~/lib/cn";
import { useOsChrome } from "~/components/os-chrome";

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

type FormVersion = ReturnType<
  typeof useLoaderData<typeof loader>
>["form"]["versions"][number];

// Editor page for a single form. A top bar (name, versions, settings, preview,
// share, publish) over either the builder — component library on the left,
// canvas on the right — or a selected version, shown as its questions or its
// results. Results belong to the version they were collected on.
//
// Two save actions (see FormBuilderTab):
//   - "Save"            → persists the editable draft (save-draft). The draft
//                         is NOT usable: published fills always serve the
//                         latest frozen version, never the draft.
//   - "Save as version" → freezes the draft into an immutable version
//                         (save-version) and clears the draft. Frozen versions
//                         are read-only and are what publishing serves.
export function FormDetail() {
  const { form, terms, usages, groups, managing, hiringLinks: rawHiringLinks, collabToken, results } = useLoaderData<typeof loader>();
  const hiringLinks: HiringFormLink[] = rawHiringLinks ?? [];
  const tz = useUserTimeZone();
  // A dedicated fetcher for Save and Publish-from-the-builder, so both
  // buttons can reflect request state. A submission carrying `publish` is the
  // Publish button's; anything else is Save's.
  const saveFetcher = useFetcher<{ ok?: boolean; error?: string }>();
  const inFlight = saveFetcher.formData;
  const publishingEdits = inFlight?.get("publish") === "true";
  const savingEdits = inFlight != null && !publishingEdits;
  const [justSaved, setJustSaved] = useState(false);
  const saveError =
    saveFetcher.data && "error" in saveFetcher.data ? saveFetcher.data.error : null;

  // Deleting a not-yet-used version (accidental-versioning cleanup). Guarded by
  // a confirm dialog; the server re-checks the lock before deleting.
  const deleteFetcher = useFetcher<{ ok?: boolean; error?: string }>();
  const confirmSubmit = useConfirmSubmit();
  const deleteError =
    deleteFetcher.data && "error" in deleteFetcher.data
      ? deleteFetcher.data.error
      : null;

  // Set while editing an existing (unused) version in place, rather than the
  // draft. Save writes back to this version id (update-version) instead of
  // appending a new one.
  const [editingVersionId, setEditingVersionId] = useState<string | null>(null);

  const latestVersion = form.versions.length
    ? form.versions[form.versions.length - 1]
    : null;
  const hasDraft = form.draft != null;

  // A version's results view lives in the URL (`?view=results&version=N`) so
  // the loader can fetch that version's responses and links can deep-link.
  const [searchParams, setSearchParams] = useSearchParams();
  const view = searchParams.get("view") === "results" ? "results" : "questions";

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
    setEditingVersionId(null);
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
  const editingVersion =
    form.versions.find((v) => v.id === editingVersionId) ?? null;

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
  } | null>(null);
  const previewFetcher = useFetcher<
    { ok: true; questions: Question[] } | { error: string }
  >();
  const previewPendingDescription = useRef<unknown>(null);
  function requestPreview(payload: { questions: Question[]; description: unknown }) {
    previewPendingDescription.current = payload.description;
    const fd = new FormData();
    fd.set("questions", JSON.stringify(payload.questions));
    previewFetcher.submit(fd, { method: "post", action: "/forms/preview-resolve" });
  }
  useEffect(() => {
    const data = previewFetcher.data;
    if (data && "questions" in data) {
      setPreviewData({
        questions: data.questions,
        description: previewPendingDescription.current,
      });
    }
  }, [previewFetcher.data]);
  const previewResolving = previewFetcher.state !== "idle";

  // Open the builder and switch to it, seeded from (in order): an explicit
  // source version, the resumable draft, the latest frozen version (so "New
  // version" carries the current questions forward to add to), else blank.
  function startEditing(from?: { questions: Question[]; description: unknown }) {
    if (searchParams.has("view")) {
      setSearchParams({}, { replace: true, preventScrollReset: true });
    }
    setEditingVersionId(null);
    setSeed(
      from ??
        form.draft ??
        (latestVersion
          ? { questions: latestVersion.questions, description: latestVersion.description }
          : { questions: [], description: null }),
    );
    setEditKey((k) => k + 1);
    setIsEditing(true);
  }

  // Edit an existing, not-yet-used version in place. Seeds the builder from
  // that version and routes Save to update-version (see handleUpdateVersion).
  function startEditingVersion(version: (typeof form.versions)[number]) {
    if (searchParams.has("view")) {
      setSearchParams({}, { replace: true, preventScrollReset: true });
    }
    setSelectedVersionId(version.id);
    setEditingVersionId(version.id);
    setSeed({ questions: version.questions, description: version.description });
    setEditKey((k) => k + 1);
    setIsEditing(true);
  }

  // Save and Publish share one submission: Save persists the draft (or, when
  // fixing an unused version in place, that version); Publish freezes the
  // edits into a version — a new one, or the one being fixed — and publishes.
  function submitEdits(
    { questions, description }: { questions: Question[]; description: unknown },
    publish: boolean,
  ) {
    const fd = new FormData();
    fd.set("id", form.id);
    if (editingVersionId) {
      fd.set("intent", "update-version");
      fd.set("versionId", editingVersionId);
    } else {
      fd.set("intent", publish ? "save-version" : "save-draft");
    }
    if (publish) fd.set("publish", "true");
    fd.set("questions", JSON.stringify(questions));
    fd.set("description", isEmptyBlocks(description) ? "" : JSON.stringify(description));
    saveFetcher.submit(fd, { method: "post" });
  }

  // Remember what the in-flight submission was (fetcher.formData is gone by
  // the time it's idle) so its success can be handled.
  const lastSubmitRef = useRef<{ intent: string; publish: boolean } | null>(null);
  if (inFlight) {
    lastSubmitRef.current = {
      intent: String(inFlight.get("intent")),
      publish: publishingEdits,
    };
  }

  // When a submission lands: a draft Save flashes "Saved" for ~2s (it stays in
  // the editor, so the checkmark is the "it worked" signal). A new version
  // leaves edit mode via the version-count effect above; an in-place version
  // edit doesn't grow the count, so it leaves edit mode here.
  const wasSubmitting = useRef(false);
  useEffect(() => {
    const submitting = saveFetcher.state === "submitting";
    if (wasSubmitting.current && !submitting) {
      const data = saveFetcher.data;
      const last = lastSubmitRef.current;
      if (data && data.ok && last) {
        if (last.intent === "update-version") {
          setIsEditing(false);
          setEditingVersionId(null);
        }
        if (last.intent === "save-draft") {
          setJustSaved(true);
          const t = setTimeout(() => setJustSaved(false), 2000);
          wasSubmitting.current = submitting;
          return () => clearTimeout(t);
        }
      }
    }
    wasSubmitting.current = submitting;
  }, [saveFetcher.state, saveFetcher.data]);

  const saveStatus = savingEdits
    ? ("saving" as const)
    : justSaved
      ? ("saved" as const)
      : ("idle" as const);
  const busySaving = inFlight != null;
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

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex-1 min-w-[12rem]">
          <FormNameInput formId={form.id} name={form.name} />
        </div>
        <FormVersionMenu
          formId={form.id}
          versions={form.versions}
          draftQuestionCount={hasDraft ? (form.draft?.questions.length ?? 0) : null}
          currentLabel={
            isEditing
              ? editingVersion
                ? `Editing v${editingVersion.versionNumber}`
                : "Draft"
              : selectedVersion
                ? `v${selectedVersion.versionNumber}`
                : "Versions"
          }
          selectedVersionId={isEditing ? null : (selectedVersionId ?? null)}
          editingDraft={isEditing && !editingVersion}
          tz={tz}
          onOpenDraft={() => startEditing()}
          onNewVersion={() => startEditing()}
          onSelect={(v) => showVersion(v.id, "questions")}
          onResults={(v) => showVersion(v.id, "results")}
          onEdit={(v) => startEditingVersion(v)}
          deleteFetcher={deleteFetcher}
          confirmSubmit={confirmSubmit}
        />
        <FormSettingsButton
          managing={managing}
          usages={usages}
          hiringLinks={hiringLinks}
          formId={form.id}
          oneResponsePerMember={form.oneResponsePerMember}
          notifyOnSubmission={form.notifyOnSubmission}
          listed={form.listed}
          audience={form.audience}
          audienceGroupIds={form.audienceGroupIds}
          groups={groups}
          opensAt={form.opensAt}
          closesAt={form.closesAt}
        />
        <Button
          variant="secondary"
          onClick={preview}
          disabled={previewResolving || (!isEditing && !selectedVersion)}
        >
          {previewResolving ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Eye className="w-4 h-4" />
          )}
          Preview
        </Button>
        {managing ? (
          <>
            <Tooltip content="This feature decides who can fill the form and when, so publishing and sharing happen there.">
              {managing.href ? (
                <Link
                  to={managing.href}
                  className="inline-flex items-center gap-1.5 px-3 text-sm text-os-grey hover:text-foreground"
                >
                  <Lock className="w-4 h-4" />
                  Managed by {managing.label}
                </Link>
              ) : (
                <span className="inline-flex items-center gap-1.5 px-3 text-sm text-os-grey">
                  <Lock className="w-4 h-4" />
                  Managed by {managing.label}
                </span>
              )}
            </Tooltip>
            {/* The managing feature serves the latest version, so Publish
                here only freezes the edits into one. */}
            {isEditing && (
              <Tooltip content="Save your changes as a new version. The managing feature uses the latest one.">
                <Button
                  variant="primary"
                  disabled={busySaving}
                  onClick={() => builderSnapshot.current && submitEdits(builderSnapshot.current(), true)}
                >
                  {publishingEdits ? "Publishing…" : "Publish"}
                </Button>
              </Tooltip>
            )}
          </>
        ) : (
          <>
            <FormShareButton published={form.published} publicToken={form.publicToken} />
            <PublishButton
              formId={form.id}
              published={form.published}
              hasVersions={form.versions.length > 0}
              inUse={usages.length > 0}
              onPublishEdits={
                isEditing
                  ? () => builderSnapshot.current && submitEdits(builderSnapshot.current(), true)
                  : undefined
              }
              publishingEdits={publishingEdits}
              editsBusy={busySaving}
              editingVersion={editingVersion != null}
            />
          </>
        )}
      </div>

      {(deleteError || saveError) && (
        <p className="text-sm text-destructive">{deleteError ?? saveError}</p>
      )}

      {isEditing ? (
        <FormBuilderTab
          // Remount only on a deliberate re-seed (startEditing bumps
          // editKey), so a draft save's revalidation doesn't blow away
          // in-progress edits. FormBuilderTab reads its initial* props
          // only on mount.
          key={editKey}
          // Version-edit mode (editingVersion) works against the version's
          // frozen snapshot, not the shared draft room — skip collab so the
          // room's draft content can't overwrite the chosen version's questions.
          formId={editingVersion ? undefined : form.id}
          collabToken={editingVersion ? null : (collabToken ?? null)}
          initialQuestions={seed.questions}
          initialDescription={seed.description}
          terms={terms}
          allowCheckbox
          // Version-edit mode has one primary save (update in place) and
          // no draft — a draft would re-introduce the two-copy state we're
          // avoiding. Draft editing keeps both buttons.
          onSave={(payload) => submitEdits(payload, false)}
          saveStatus={saveStatus}
          snapshotRef={builderSnapshot}
          onCancel={
            (!editingVersion && form.versions.length === 0 && !hasDraft) || busySaving
              ? undefined
              : () => {
                  setIsEditing(false);
                  setEditingVersionId(null);
                }
          }
        />
      ) : selectedVersion ? (
        <div className="max-w-4xl mx-auto space-y-4">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="inline-flex p-1 rounded-full bg-os-container">
              {(["questions", "results"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => showVersion(selectedVersion.id, v)}
                  aria-pressed={view === v}
                  className={cn(
                    "px-4 py-1.5 rounded-full text-sm font-semibold transition-colors",
                    view === v
                      ? "bg-os-card text-foreground shadow-sm"
                      : "text-os-grey hover:text-foreground",
                  )}
                >
                  {v === "questions" ? "Questions" : "Results"}
                  {v === "results" && (
                    <span className="ml-1.5 tabular-nums opacity-70">
                      {selectedVersion.submissionCount}
                    </span>
                  )}
                </button>
              ))}
            </div>
            <span className="text-sm text-os-grey">
              v{selectedVersion.versionNumber} · {selectedVersion.createdByName} ·{" "}
              {formatDateTime(selectedVersion.createdAt, tz)}
            </span>
            <Button
              variant="secondary"
              size="sm"
              className="ml-auto"
              onClick={() => startEditing()}
            >
              {hasDraft ? <Pencil className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
              {hasDraft ? "Continue editing draft" : "New version"}
            </Button>
          </div>

          {view === "results" ? (
            results && results.versionId === selectedVersion.id ? (
              <VersionResults
                formId={form.id}
                versionNumber={selectedVersion.versionNumber}
                results={results}
              />
            ) : (
              <div className="py-12 flex justify-center">
                <Loader2 className="w-5 h-5 animate-spin text-os-grey" />
              </div>
            )
          ) : (
            <div className="rounded-os-card bg-os-card p-6 space-y-4">
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
                <div
                  key={q.key}
                  className="p-4 rounded-os-item border border-os-container"
                >
                  <div className="flex items-center gap-3 mb-1 flex-wrap">
                    <span className="text-sm font-medium text-muted-foreground">
                      Q{index + 1}
                    </span>
                    <h4 className="text-base font-medium text-foreground">
                      {q.data.label}
                    </h4>
                    {q.required && (
                      <span className={BADGE.accent}>
                        Required
                      </span>
                    )}
                  </div>
                  {q.data.description && (
                    <p className="text-sm text-muted-foreground mb-2">
                      {q.data.description}
                    </p>
                  )}
                  {(q.type === "select" ||
                    q.type === "skills_rating" ||
                    q.type === "checkbox") &&
                    q.data.options && (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {q.data.options.map((opt) => (
                          <span
                            key={opt}
                            className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-os-well text-os-grey border border-os-container"
                          >
                            {opt}
                          </span>
                        ))}
                      </div>
                    )}
                  {q.type === "file" && q.data.accept && (
                    <p className="text-xs text-muted-foreground mt-1">
                      Accepts: {q.data.accept}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="max-w-4xl mx-auto text-center py-12 rounded-os-card bg-os-card">
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
          formName={form.name}
          description={previewData.description}
          questions={previewData.questions}
          onClose={() => setPreviewData(null)}
        />
      )}
    </div>
  );
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
        "z-[60] w-80 max-w-[calc(100vw-2rem)] overflow-y-auto overflow-x-hidden p-2 focus:outline-none",
        popover,
      )}
      trigger={
        <button
          type="button"
          className="inline-flex items-center gap-2 h-10 px-3.5 rounded-full text-sm font-semibold text-os-grey hover:bg-os-container hover:text-foreground transition-colors"
        >
          <History className="w-5 h-5" />
          {currentLabel}
          <ChevronDown className="w-4 h-4" />
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
                {draftQuestionCount} {draftQuestionCount === 1 ? "question" : "questions"} · unsaved
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
                {/* An unused version (no responses, no hiring pin) can be
                    fixed in place or removed — this is how an accidental
                    "Save as version" gets corrected without accreting dead
                    versions. Once used, the version freezes. */}
                {!v.locked && (
                  <>
                    <Tooltip content="Edit in place">
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

// The fill link, next to Publish. A published form is fillable at
// /forms/fill/:publicToken; unpublishing 404s that route but keeps the token
// so re-publishing restores the same link.
function FormShareButton({
  published,
  publicToken,
}: {
  published: boolean;
  publicToken: string | null;
}) {
  const { popover } = useOsChrome();
  const [copied, setCopied] = useState(false);
  const publicUrl =
    published && publicToken
      ? `${typeof window !== "undefined" ? window.location.origin : ""}/forms/fill/${publicToken}`
      : null;

  async function copy() {
    if (!publicUrl) return;
    try {
      await navigator.clipboard.writeText(publicUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — user can select the text manually */
    }
  }

  if (!publicUrl) {
    return (
      <Tooltip content="Publish to get a link">
        <span>
          <Button variant="secondary" disabled>
            <Share2 className="w-4 h-4" />
            Share
          </Button>
        </span>
      </Tooltip>
    );
  }

  return (
    <Popover
      align="right"
      ariaLabel="Share"
      panelClassName={cn(
        "z-[60] w-96 max-w-[calc(100vw-2rem)] p-3 os-form focus:outline-none",
        popover,
      )}
      trigger={
        <button type="button" className="os-edit-btn">
          <Share2 className="w-4 h-4" />
          Share
        </button>
      }
    >
      <div className="flex items-center gap-2">
        <input
          type="text"
          readOnly
          value={publicUrl}
          onFocus={(e) => e.currentTarget.select()}
          className="flex-1 min-w-0 font-mono text-xs"
          aria-label="Form link"
        />
        <Button variant="primary" size="sm" onClick={copy}>
          {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
    </Popover>
  );
}

// Publish. While editing it freezes the builder's edits into a version and
// publishes them (onPublishEdits); otherwise it publishes the latest version,
// or unpublishes a published form.
function PublishButton({
  formId,
  published,
  hasVersions,
  inUse,
  onPublishEdits,
  publishingEdits,
  editsBusy,
  editingVersion,
}: {
  formId: string;
  published: boolean;
  hasVersions: boolean;
  inUse: boolean;
  onPublishEdits?: () => void;
  publishingEdits: boolean;
  editsBusy: boolean;
  editingVersion: boolean;
}) {
  const fetcher = useFetcher<{ error?: string }>();
  const dialog = useDialog();
  const busy = fetcher.state !== "idle";
  const err = fetcher.data?.error ?? null;

  if (onPublishEdits) {
    return (
      <Tooltip
        content={
          editingVersion
            ? "Save this version and make it live at the share link."
            : "Save your changes as a new version and make it live at the share link."
        }
      >
        <Button variant="primary" onClick={onPublishEdits} disabled={editsBusy}>
          {publishingEdits ? "Publishing…" : "Publish"}
        </Button>
      </Tooltip>
    );
  }

  async function toggle() {
    if (
      published &&
      inUse &&
      !(await dialog.confirm({
        title: "Unpublish this form?",
        description:
          "It's in use elsewhere. Unpublishing hides it there until you publish again.",
        confirmLabel: "Unpublish",
      }))
    ) {
      return;
    }
    fetcher.submit(
      { intent: published ? "unpublish-form" : "publish-form", id: formId },
      { method: "post" },
    );
  }

  return (
    <Tooltip
      content={
        err ??
        (published
          ? "Take the form offline. The link stops working until you publish again."
          : hasVersions
            ? "Make the latest version live at the share link."
            : "Add questions first.")
      }
      variant="rich"
      placement="bottom"
    >
      <span>
        <Button
          variant={published ? "secondary" : "primary"}
          onClick={toggle}
          disabled={busy || (!published && !hasVersions)}
        >
          {busy ? "Saving…" : published ? "Unpublish" : "Publish"}
        </Button>
      </span>
    </Tooltip>
  );
}

// Inline-editable form title. Saves on blur/Enter; Escape or an empty value
// reverts to the saved name.
function FormNameInput({ formId, name }: { formId: string; name: string }) {
  const fetcher = useFetcher();
  const [value, setValue] = useState(name);
  useEffect(() => setValue(name), [name]);

  function commit() {
    const next = value.trim();
    if (!next || next === name) {
      setValue(name);
      return;
    }
    fetcher.submit(
      { intent: "rename-form", id: formId, name: next },
      { method: "post" },
    );
  }

  return (
    <input
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          const el = e.currentTarget;
          setValue(name);
          requestAnimationFrame(() => el.blur());
        }
      }}
      maxLength={120}
      aria-label="Form name"
      className="w-full px-3 py-1.5 rounded-os-item bg-transparent font-heading text-2xl font-semibold text-foreground outline-none hover:bg-os-container focus:bg-os-container"
    />
  );
}
