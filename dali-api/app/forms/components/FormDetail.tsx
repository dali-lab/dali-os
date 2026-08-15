import { useState, useEffect, useRef } from "react";
import { Link, useLoaderData, useFetcher } from "react-router";
import {
  Plus,
  Pencil,
  FileText,
  Clock,
  UserIcon,
  Globe,
  Lock,
  Copy,
  Check,
  Inbox,
  Eye,
  Loader2,
} from "lucide-react";
import { FormBuilderTab } from "~/components/form-builder/FormBuilder";
import { FormPreviewModal } from "~/forms/components/FormPreviewModal";
import { DocEditor } from "~/components/doc";
import { isEmptyBlocks } from "~/lib/blocks";
import { Button, buttonClasses } from "~/components/ui/Button";
import { Checkbox } from "~/components/ui/Checkbox";
import { Radio } from "~/components/ui/Radio";
import { Tooltip } from "~/components/ui/IconButton";
import type { Question } from "~/types";
import type { loader } from "~/forms/routes/forms.edit.$formId";
import { useUserTimeZone } from "~/hooks/useUserTimeZone";
import { formatInTimeZone } from "~/lib/timezone";
import { DateField } from "~/components/ui/DateField";

function formatDateTime(iso: string, tz: string) {
  return (
    formatInTimeZone(iso, tz, { month: "short", day: "numeric", year: "numeric" }) +
    " at " +
    formatInTimeZone(iso, tz, { hour: "numeric", minute: "2-digit" })
  );
}

// Compact one-line form for the narrow versions sidebar, e.g. "May 24, 11:49 AM".
function formatDateShort(iso: string, tz: string) {
  return (
    formatInTimeZone(iso, tz, { month: "short", day: "numeric" }) +
    ", " +
    formatInTimeZone(iso, tz, { hour: "numeric", minute: "2-digit" })
  );
}

// Editor page for a single form. A versions sidebar on the left; on the right,
// the builder when editing the draft, or a read-only preview of a selected
// version otherwise.
//
// Two save actions (see FormBuilderTab):
//   - "Save"            → persists the editable draft (save-draft). The draft
//                         is NOT usable: published fills always serve the
//                         latest frozen version, never the draft.
//   - "Save as version" → freezes the draft into an immutable version
//                         (save-version) and clears the draft. Frozen versions
//                         are read-only and are what publishing serves.
export function FormDetail() {
  const { form, terms, usages, groups, managing } = useLoaderData<typeof loader>();
  const tz = useUserTimeZone();
  // A dedicated fetcher for saves so the builder's buttons can reflect
  // request state ("Saving…"/"Saved ✓"). The submitted intent tells us which
  // button is in flight; fetcher.state + a brief post-success window drive the
  // "Saved" confirmation.
  const saveFetcher = useFetcher<{ ok?: boolean; error?: string }>();
  const savingIntent = saveFetcher.formData?.get("intent") as
    | "save-draft"
    | "save-version"
    | null;
  const [justSaved, setJustSaved] = useState<null | "draft" | "version">(null);
  const saveError =
    saveFetcher.data && "error" in saveFetcher.data ? saveFetcher.data.error : null;

  const latestVersion = form.versions.length
    ? form.versions[form.versions.length - 1]
    : null;
  const hasDraft = form.draft != null;

  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(
    () => latestVersion?.id ?? null,
  );
  // Open straight into the builder when there's a draft to resume or no
  // version exists yet; otherwise land on the latest version's preview.
  const [isEditing, setIsEditing] = useState(hasDraft || form.versions.length === 0);

  const selectedVersion = form.versions.find(
    (v) => v.id === selectedVersionId,
  );
  const nextVersionNumber = form.versions.length + 1;

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

  function handleSaveDraft({
    questions,
    description,
  }: {
    questions: Question[];
    description: unknown;
  }) {
    const fd = new FormData();
    fd.set("intent", "save-draft");
    fd.set("id", form.id);
    fd.set("questions", JSON.stringify(questions));
    fd.set("description", isEmptyBlocks(description) ? "" : JSON.stringify(description));
    saveFetcher.submit(fd, { method: "post" });
  }

  function handleSaveVersion({
    questions,
    description,
  }: {
    questions: Question[];
    description: unknown;
  }) {
    const fd = new FormData();
    fd.set("intent", "save-version");
    fd.set("id", form.id);
    fd.set("questions", JSON.stringify(questions));
    fd.set("description", isEmptyBlocks(description) ? "" : JSON.stringify(description));
    saveFetcher.submit(fd, { method: "post" });
  }

  // Remember the intent of the in-flight save so the post-success flash knows
  // which button to mark (fetcher.formData is gone by the time it's idle).
  const lastIntentRef = useRef<"save-draft" | "save-version" | null>(null);
  if (savingIntent) lastIntentRef.current = savingIntent;

  // When a save finishes (fetcher leaves "submitting", data ok), flash "Saved"
  // on the button for ~2s. The draft save stays in the editor, so this
  // transient checkmark is the main "it worked" signal; the version save also
  // leaves edit mode (the version-count effect above), so the user sees the
  // new read-only version.
  const wasSubmitting = useRef(false);
  useEffect(() => {
    const submitting = saveFetcher.state === "submitting";
    if (wasSubmitting.current && !submitting) {
      const data = saveFetcher.data;
      if (data && data.ok) {
        setJustSaved(lastIntentRef.current === "save-version" ? "version" : "draft");
        const t = setTimeout(() => setJustSaved(null), 2000);
        wasSubmitting.current = submitting;
        return () => clearTimeout(t);
      }
    }
    wasSubmitting.current = submitting;
  }, [saveFetcher.state, saveFetcher.data]);

  // Roll up the fetcher state into the builder's saveStatus prop.
  const saveStatus =
    savingIntent === "save-draft"
      ? ("saving-draft" as const)
      : savingIntent === "save-version"
        ? ("saving-version" as const)
        : justSaved === "draft"
          ? ("saved-draft" as const)
          : justSaved === "version"
            ? ("saved-version" as const)
            : ("idle" as const);

  return (
    <div className="space-y-6">
      <div>
        <div className="flex justify-between items-start">
          <div>
            <h1 className="text-2xl font-bold text-foreground">{form.name}</h1>
            <p className="mt-1 text-muted-foreground">
              Created {new Date(form.createdAt).toLocaleDateString()}
            </p>
            {usages.length > 0 && (
              <div className="mt-2 flex items-center gap-1.5 flex-wrap text-xs">
                <span className="text-muted-foreground font-medium">In use:</span>
                {usages.map((u) => (
                  <span
                    key={`${u.kind}:${u.label}`}
                    className="inline-flex items-center px-2 py-0.5 rounded-full bg-accent-teal/10 text-accent-teal border border-accent-teal/20"
                  >
                    {u.label}
                  </span>
                ))}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            {!isEditing && (
              <Button
                variant="primary"
                size="sm"
                onClick={() => startEditing()}
              >
                <Plus className="w-4 h-4" />
                {hasDraft ? "Continue editing draft" : "New version"}
              </Button>
            )}
          </div>
        </div>

        {managing ? (
          <div className="rounded-lg border border-blue-200 bg-blue-50 dark:border-blue-900/40 dark:bg-blue-900/20 p-4 flex items-start gap-3">
            <Lock className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
            <div className="text-sm text-blue-900 dark:text-blue-200">
              <p className="font-semibold">Managed form — {managing.label}</p>
              <p className="mt-0.5 text-blue-800/80 dark:text-blue-300/80">
                Who can fill this form and when is controlled by that feature, so
                publishing, the public link, schedule, audience, and response
                settings don&apos;t apply here. Edit the questions below; the
                feature serves the latest saved version.
              </p>
            </div>
          </div>
        ) : (
          <>
            <PublishControl
              formId={form.id}
              published={form.published}
              publicToken={form.publicToken}
              hasVersions={form.versions.length > 0}
              inUse={usages.length > 0}
              audience={form.audience}
            />

            <FormSettingsCard
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
          </>
        )}
      </div>

      <div className="flex flex-col lg:flex-row gap-8">
        {/* Left: draft + versions list */}
        <div className="w-full lg:w-64 flex-shrink-0 space-y-4">
          {/* Unsaved working copy — editable, not usable until saved as a
              version. Highlighted so it's clearly distinct from frozen ones. */}
          {hasDraft && (
            <div className="space-y-2">
              <h3 className="text-sm font-bold text-foreground uppercase tracking-wider">
                Draft
              </h3>
              <button
                onClick={() => startEditing(form.draft ?? undefined)}
                className={`w-full text-left p-4 rounded-xl border transition-colors ${
                  isEditing
                    ? "border-accent-coral bg-accent-coral/10 ring-1 ring-accent-coral"
                    : "border-dashed border-accent-coral/50 bg-card hover:bg-muted/50"
                }`}
              >
                <div className="flex items-center gap-2">
                  <Pencil className="w-3.5 h-3.5 text-accent-coral flex-shrink-0" />
                  <span className="font-medium text-foreground">
                    Unsaved draft
                  </span>
                </div>
                <p className="text-sm text-muted-foreground mt-1">
                  {form.draft?.questions.length ?? 0} questions · not yet usable
                </p>
              </button>
            </div>
          )}

          <h3 className="text-sm font-bold text-foreground uppercase tracking-wider">
            Versions
          </h3>
          {form.versions.length === 0 ? (
            <p className="text-sm text-muted-foreground">No versions yet.</p>
          ) : (
            <div className="space-y-2">
              {[...form.versions].reverse().map((version, i) => {
                const isLatest = i === 0;
                return (
                  <div
                    key={version.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => {
                      setSelectedVersionId(version.id);
                      setIsEditing(false);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setSelectedVersionId(version.id);
                        setIsEditing(false);
                      }
                    }}
                    className={`w-full text-left p-3 rounded-xl border transition-colors cursor-pointer ${
                      selectedVersionId === version.id && !isEditing
                        ? "border-accent-teal bg-accent-teal/10 ring-1 ring-accent-teal"
                        : "border-border bg-card hover:bg-muted/50"
                    }`}
                  >
                    {/* Title row: version number, the "Live" badge on the
                        latest frozen version (what published fills serve), and
                        the question count — all on one line. */}
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-foreground">
                        v{version.versionNumber}
                      </span>
                      {isLatest && (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-accent-teal/15 text-accent-teal">
                          Live
                        </span>
                      )}
                      <span className="text-xs text-muted-foreground">
                        · {version.questions.length}{" "}
                        {version.questions.length === 1 ? "question" : "questions"}
                      </span>
                    </div>
                    {/* Metadata: each on its own full-width line so the
                        timestamp never wraps mid-value. */}
                    <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                      <div className="flex items-center gap-1.5">
                        <Clock className="w-3 h-3 flex-shrink-0" />
                        <span className="truncate">{formatDateShort(version.createdAt, tz)}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <UserIcon className="w-3 h-3 flex-shrink-0" />
                        <span className="truncate">{version.createdByName}</span>
                      </div>
                    </div>
                    {/* Responses are stored per-version — link straight into
                        the responses page pre-filtered to this version. */}
                    <Link
                      to={`/forms/responses/${form.id}?version=${version.versionNumber}`}
                      onClick={(e) => e.stopPropagation()}
                      className={buttonClasses(
                        "secondary",
                        "sm",
                        "mt-2 w-full gap-1.5",
                      )}
                    >
                      <Inbox className="w-3.5 h-3.5" />
                      Responses
                      <span className="tabular-nums opacity-80">
                        {version.submissionCount}
                      </span>
                    </Link>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Right: builder or preview */}
        <div className="flex-1">
          {isEditing ? (
            <div className="bg-card rounded-xl border border-border shadow-sm p-6">
              <div className="mb-6 pb-6 border-b border-border">
                <h2 className="text-lg font-bold text-foreground">
                  {form.versions.length === 0
                    ? "Build this form"
                    : "Edit draft"}
                </h2>
                <p className="text-sm text-muted-foreground mt-1">
                  <strong className="font-medium text-foreground">Save</strong>{" "}
                  keeps an editable draft — it isn't usable yet.{" "}
                  <strong className="font-medium text-foreground">
                    Save as version
                  </strong>{" "}
                  freezes it as v{nextVersionNumber}; published forms always
                  serve the latest saved version.
                </p>
              </div>
              <FormBuilderTab
                // Remount only on a deliberate re-seed (startEditing bumps
                // editKey), so a draft save's revalidation doesn't blow away
                // in-progress edits. FormBuilderTab reads its initial* props
                // only on mount.
                key={editKey}
                initialQuestions={seed.questions}
                initialDescription={seed.description}
                terms={terms}
                allowCheckbox
                onSaveDraft={handleSaveDraft}
                onSave={handleSaveVersion}
                saveLabel="Save as version"
                saveStatus={saveStatus}
                onPreview={requestPreview}
                previewPending={previewResolving}
                onCancel={
                  form.versions.length === 0 && !hasDraft
                    ? undefined
                    : () => setIsEditing(false)
                }
              />
              {saveError && (
                <p className="mt-3 text-sm text-destructive">{saveError}</p>
              )}
            </div>
          ) : selectedVersion ? (
            <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
              {/* A saved version is immutable — no edit affordance here. Make a
                  new version with the header's "New version" button instead. */}
              <div className="px-6 py-5 border-b border-border bg-muted/50 flex justify-between items-center">
                <div>
                  <h2 className="text-lg font-semibold text-foreground">
                    Version {selectedVersion.versionNumber} · read-only
                  </h2>
                  <p className="text-sm text-muted-foreground mt-1">
                    Created by {selectedVersion.createdByName} on{" "}
                    {formatDateTime(selectedVersion.createdAt, tz)}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    disabled={previewResolving}
                    onClick={() =>
                      requestPreview({
                        questions: selectedVersion.questions,
                        description: selectedVersion.description,
                      })
                    }
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-foreground/80 hover:text-foreground px-2.5 py-1.5 rounded-md border border-border bg-card hover:bg-muted/50 disabled:opacity-60"
                  >
                    {previewResolving ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Eye className="w-3.5 h-3.5" />
                    )}
                    Preview
                  </button>
                  <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                    <Lock className="w-3.5 h-3.5" />
                    Read-only
                  </span>
                </div>
              </div>

              <div className="p-6 space-y-4">
                {!isEmptyBlocks(selectedVersion.description) && (
                  <div className="px-4 py-3 rounded-lg border border-border bg-muted/30">
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
                    className="flex items-start gap-4 p-4 rounded-xl border border-border bg-card"
                  >
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-1">
                        <span className="text-sm font-medium text-muted-foreground">
                          Q{index + 1}
                        </span>
                        <h4 className="text-base font-medium text-foreground">
                          {q.data.label}
                        </h4>
                        {q.required && (
                          <span className="text-xs font-medium text-red-600 bg-red-50 px-2 py-0.5 rounded-full">
                            Required
                          </span>
                        )}
                        <span className="text-xs font-medium text-muted-foreground bg-muted px-2 py-0.5 rounded-full capitalize">
                          {q.type}
                        </span>
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
                                className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-accent-teal/10 text-accent-teal border border-accent-teal/20"
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
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="text-center py-12 bg-card rounded-xl border border-border border-dashed">
              <FileText className="mx-auto h-12 w-12 text-muted-foreground/70" />
              <h3 className="mt-2 text-sm font-medium text-foreground">
                No versions
              </h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Get started by building this form.
              </p>
              <div className="mt-6">
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => startEditing()}
                >
                  <Plus className="w-4 h-4" />
                  Build form
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>

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

// Publish toggle + shareable link. A published form is fillable by logged-in
// members at /forms/fill/:publicToken; unpublishing 404s that route but keeps
// the token so re-publishing restores the same link.
type AudienceValue = "Members" | "SignedIn" | "Groups" | "Public";
type GroupOption = { id: string; name: string; type: "Static" | "Dynamic" };

const AUDIENCE_OPTIONS: {
  value: AudienceValue;
  label: string;
  description: string;
}[] = [
  {
    value: "Members",
    label: "Lab members",
    description: "Signed-in lab members (default).",
  },
  {
    value: "SignedIn",
    label: "Anyone signed in",
    description: "Any DALI OS account — members, Dartmouth students, partners.",
  },
  {
    value: "Groups",
    label: "Specific groups",
    description: "Signed-in users in at least one selected group.",
  },
  {
    value: "Public",
    label: "Public",
    description:
      "Anyone with the link, no sign-in. Add name/email questions yourself if you need them; submissions record the sender's IP.",
  },
];

// Per-form response settings + audience. Toggles submit both boolean values
// (single idempotent update); audience submits on radio change — except
// "Specific groups", which waits until at least one group is checked (the
// server enforces the same rule). Pending fetcher FormData drives optimistic
// state so changes feel instant and settle to the loader's truth.
// ISO timestamp → the local wall-time string a datetime-local input expects.
function toLocalInputValue(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function FormSettingsCard({
  formId,
  oneResponsePerMember,
  notifyOnSubmission,
  listed,
  audience,
  audienceGroupIds,
  groups,
  opensAt,
  closesAt,
}: {
  formId: string;
  oneResponsePerMember: boolean;
  notifyOnSubmission: boolean;
  listed: boolean;
  audience: AudienceValue;
  audienceGroupIds: string[];
  groups: GroupOption[];
  opensAt: string | null;
  closesAt: string | null;
}) {
  const fetcher = useFetcher();
  const err =
    fetcher.data && typeof fetcher.data === "object" && "error" in fetcher.data
      ? String((fetcher.data as { error: unknown }).error)
      : null;

  const pending = fetcher.formData;
  const pendingSettings = pending?.get("intent") === "update-form-settings";
  const oneResponse = pendingSettings
    ? pending!.get("oneResponsePerMember") === "true"
    : oneResponsePerMember;
  const notify = pendingSettings
    ? pending!.get("notifyOnSubmission") === "true"
    : notifyOnSubmission;
  const isListed = pendingSettings
    ? pending!.get("listed") === "true"
    : listed;

  // Window edits stage locally and save on the button — datetime inputs fire
  // change per keystroke in some browsers, so instant-save would spam.
  const [draftOpensAt, setDraftOpensAt] = useState(() => toLocalInputValue(opensAt));
  const [draftClosesAt, setDraftClosesAt] = useState(() => toLocalInputValue(closesAt));
  const windowDirty =
    draftOpensAt !== toLocalInputValue(opensAt) ||
    draftClosesAt !== toLocalInputValue(closesAt);

  function saveWindow() {
    fetcher.submit(
      {
        intent: "update-form-window",
        id: formId,
        opensAt: draftOpensAt ? new Date(draftOpensAt).toISOString() : "",
        closesAt: draftClosesAt ? new Date(draftClosesAt).toISOString() : "",
      },
      { method: "post" },
    );
  }

  // Audience edits stage locally: picking "Specific groups" with nothing
  // checked must not submit (the saved audience stays live until a valid
  // selection exists).
  const [draftAudience, setDraftAudience] = useState<AudienceValue>(audience);
  const [groupSel, setGroupSel] = useState<Set<string>>(
    () => new Set(audienceGroupIds),
  );

  function saveSettings(
    nextOneResponse: boolean,
    nextNotify: boolean,
    nextListed: boolean,
  ) {
    fetcher.submit(
      {
        intent: "update-form-settings",
        id: formId,
        oneResponsePerMember: String(nextOneResponse),
        notifyOnSubmission: String(nextNotify),
        listed: String(nextListed),
      },
      { method: "post" },
    );
  }

  function saveAudience(nextAudience: AudienceValue, ids: Set<string>) {
    fetcher.submit(
      {
        intent: "update-form-audience",
        id: formId,
        audience: nextAudience,
        groupIds: JSON.stringify([...ids]),
      },
      { method: "post" },
    );
  }

  function pickAudience(next: AudienceValue) {
    setDraftAudience(next);
    if (next !== "Groups") {
      saveAudience(next, new Set());
      return;
    }
    if (groupSel.size > 0) saveAudience("Groups", groupSel);
  }

  function toggleGroup(id: string) {
    const next = new Set(groupSel);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setGroupSel(next);
    if (draftAudience === "Groups" && next.size > 0) {
      saveAudience("Groups", next);
    }
  }

  return (
    <div className="mt-3 rounded-lg border border-border bg-card p-4 flex flex-col gap-3">
      <span className="text-sm font-medium text-foreground">Settings</span>
      <Checkbox
        checked={oneResponse}
        onChange={(e) => saveSettings(e.target.checked, notify, isListed)}
        label="One response per member"
        description="Signed-in members can only submit this form once. Doesn't apply to staffing or education fills."
      />
      <Checkbox
        checked={notify}
        onChange={(e) => saveSettings(oneResponse, e.target.checked, isListed)}
        label="Notify on submission"
        description="Get an in-app notification whenever someone submits a response."
      />
      <Checkbox
        checked={isListed}
        onChange={(e) => saveSettings(oneResponse, notify, e.target.checked)}
        label="List in Forms for you"
        description="Show this form on Home for people its audience includes. Unlisted forms are reachable only by link."
      />

      <div className="border-t border-border pt-3 flex flex-col gap-2">
        <span className="text-sm font-medium text-foreground">Schedule</span>
        <span className="text-xs text-muted-foreground">
          Publishes at open and unpublishes at close, automatically. Leave
          blank to keep manual control.
        </span>
        <label className="flex items-center gap-2 text-sm">
          <span className="w-14 text-muted-foreground">Opens</span>
          <DateField
            mode="datetime-local"
            value={draftOpensAt}
            onChange={(value) => setDraftOpensAt(value)}
            ariaLabel="Opens at"
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <span className="w-14 text-muted-foreground">Closes</span>
          <DateField
            mode="datetime-local"
            value={draftClosesAt}
            onChange={(value) => setDraftClosesAt(value)}
            ariaLabel="Closes at"
          />
        </label>
        {windowDirty && (
          <Button
            variant="secondary"
            size="sm"
            onClick={saveWindow}
            className="self-start"
          >
            Save schedule
          </Button>
        )}
      </div>

      <div className="border-t border-border pt-3 flex flex-col gap-2">
        <span className="text-sm font-medium text-foreground">
          Who can fill this form
        </span>
        {AUDIENCE_OPTIONS.map((opt) => (
          <Radio
            key={opt.value}
            name="form-audience"
            checked={draftAudience === opt.value}
            onChange={() => pickAudience(opt.value)}
            label={opt.label}
            description={opt.description}
          />
        ))}

        {draftAudience === "Groups" && (
          <div className="ml-6 flex flex-col gap-1.5">
            {groups.length === 0 ? (
              <span className="text-xs text-muted-foreground">
                No groups exist yet — create them in Admin › Groups.
              </span>
            ) : (
              groups.map((g) => (
                <Checkbox
                  key={g.id}
                  checked={groupSel.has(g.id)}
                  onChange={() => toggleGroup(g.id)}
                  label={
                    <>
                      <span className="text-sm text-foreground truncate">{g.name}</span>
                      <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full shrink-0">
                        {g.type}
                      </span>
                    </>
                  }
                />
              ))
            )}
            {groupSel.size === 0 && (
              <span className="text-xs text-amber-700">
                Select at least one group — until then the saved audience stays
                in effect.
              </span>
            )}
          </div>
        )}
      </div>

      {err && <div className="text-destructive text-xs">{err}</div>}
    </div>
  );
}

const PUBLISHED_COPY: Record<AudienceValue, string> = {
  Members:
    "The latest version is live - any logged-in member can fill it via the link.",
  SignedIn:
    "The latest version is live — anyone signed in to DALI OS can fill it via the link.",
  Groups:
    "The latest version is live — members of the selected groups can fill it via the link.",
  Public:
    "The latest version is live — anyone with the link can fill it, no sign-in needed.",
};

function PublishControl({
  formId,
  published,
  publicToken,
  hasVersions,
  inUse,
  audience,
}: {
  formId: string;
  published: boolean;
  publicToken: string | null;
  hasVersions: boolean;
  inUse: boolean;
  audience: AudienceValue;
}) {
  const fetcher = useFetcher();
  const [copied, setCopied] = useState(false);
  const busy = fetcher.state !== "idle";
  const err =
    fetcher.data && typeof fetcher.data === "object" && "error" in fetcher.data
      ? String((fetcher.data as { error: unknown }).error)
      : null;

  const publicUrl =
    published && publicToken
      ? `${typeof window !== "undefined" ? window.location.origin : ""}/forms/fill/${publicToken}`
      : null;

  function toggle() {
    fetcher.submit(
      { intent: published ? "unpublish-form" : "publish-form", id: formId },
      { method: "post" },
    );
  }
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

  return (
    <div className="mt-4 rounded-lg border border-border bg-card p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 text-sm">
          {published ? (
            <Globe className="w-4 h-4 text-green-600" />
          ) : (
            <Lock className="w-4 h-4 text-muted-foreground" />
          )}
          <span className="font-medium text-foreground">
            {published ? "Published" : "Not published"}
          </span>
          <span className="text-muted-foreground">
            {published ? PUBLISHED_COPY[audience] : "Only lab staff can see this form."}
          </span>
        </div>
        <button
          type="button"
          onClick={toggle}
          disabled={busy || (!published && !hasVersions)}
          title={
            !published && !hasVersions
              ? "Add a question version before publishing"
              : undefined
          }
          className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors disabled:opacity-60 disabled:cursor-not-allowed ${
            published
              ? "border border-border text-foreground hover:bg-muted/50"
              : "bg-accent-coral text-white hover:bg-accent-coral/90"
          }`}
        >
          {busy
            ? "Saving…"
            : published
              ? "Unpublish"
              : "Publish"}
        </button>
      </div>

      {err && (
        <div className="text-destructive text-xs">{err}</div>
      )}

      {published && inUse && (
        <p className="text-xs text-amber-700">
          This form is in use (see above) — unpublishing hides it from those
          surfaces until it's re-published.
        </p>
      )}

      {publicUrl && (
        <div className="flex items-center gap-2">
          <input
            readOnly
            value={publicUrl}
            onFocus={(e) => e.currentTarget.select()}
            className="flex-1 min-w-0 px-2 py-1.5 text-xs border border-border rounded-md bg-background text-foreground font-mono"
          />
          <Tooltip label="Copy link">
            <button
              type="button"
              onClick={copy}
              aria-label="Copy link"
              className="inline-flex items-center justify-center p-1.5 text-xs border border-border rounded-md text-foreground hover:bg-muted/50 transition-colors"
            >
              {copied ? (
                <Check className="w-3.5 h-3.5" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
            </button>
          </Tooltip>
        </div>
      )}
    </div>
  );
}
