import { useState, useEffect, useRef } from "react";
import { useLoaderData, useFetcher } from "react-router";
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
} from "lucide-react";
import { FormBuilderTab } from "~/hiring/components/ChallengeBuilder";
import { RichTextViewer, isEmptyDoc } from "~/components/RichTextViewer";
import type { Question } from "~/types";
import type { loader } from "~/forms/routes/forms.edit.$formId";

function formatDateTime(iso: string) {
  const d = new Date(iso);
  return (
    d.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    }) +
    " at " +
    d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
  );
}

// Compact one-line form for the narrow versions sidebar, e.g. "May 24, 11:49 AM".
function formatDateShort(iso: string) {
  const d = new Date(iso);
  return (
    d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) +
    ", " +
    d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
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
  const { form, terms } = useLoaderData<typeof loader>();
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

  // Open the builder seeded from a given version (or blank) and switch to it.
  function startEditing(from?: { questions: Question[]; description: unknown }) {
    setSeed(
      from ?? form.draft ?? { questions: [], description: null },
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
    fd.set("description", description ? JSON.stringify(description) : "");
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
    fd.set("description", description ? JSON.stringify(description) : "");
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
          </div>
          {!isEditing && (
            <button
              onClick={() => startEditing()}
              className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-lg text-white bg-accent-coral hover:bg-accent-coral/90 shadow-sm"
            >
              <Plus className="w-4 h-4 mr-2" />
              {hasDraft ? "Continue editing draft" : "New version"}
            </button>
          )}
        </div>

        <PublishControl
          formId={form.id}
          published={form.published}
          publicToken={form.publicToken}
          hasVersions={form.versions.length > 0}
        />
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
                  <button
                    key={version.id}
                    onClick={() => {
                      setSelectedVersionId(version.id);
                      setIsEditing(false);
                    }}
                    className={`w-full text-left p-3 rounded-xl border transition-colors ${
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
                        <span className="truncate">{formatDateShort(version.createdAt)}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <UserIcon className="w-3 h-3 flex-shrink-0" />
                        <span className="truncate">{version.createdByName}</span>
                      </div>
                    </div>
                  </button>
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
                onSaveDraft={handleSaveDraft}
                onSave={handleSaveVersion}
                saveLabel="Save as version"
                saveStatus={saveStatus}
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
                    {formatDateTime(selectedVersion.createdAt)}
                  </p>
                </div>
                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <Lock className="w-3.5 h-3.5" />
                  Read-only
                </span>
              </div>

              <div className="p-6 space-y-4">
                {!isEmptyDoc(selectedVersion.description) && (
                  <div className="px-4 py-3 rounded-lg border border-border bg-muted/30">
                    <RichTextViewer content={selectedVersion.description} />
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
                      {(q.type === "select" || q.type === "skills_rating") &&
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
                <button
                  onClick={() => startEditing()}
                  className="inline-flex items-center px-4 py-2 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-accent-coral hover:bg-accent-coral/90"
                >
                  <Plus className="w-4 h-4 mr-2" />
                  Build form
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Publish toggle + shareable link. A published form is fillable by logged-in
// members at /forms/fill/:publicToken; unpublishing 404s that route but keeps
// the token so re-publishing restores the same link.
function PublishControl({
  formId,
  published,
  publicToken,
  hasVersions,
}: {
  formId: string;
  published: boolean;
  publicToken: string | null;
  hasVersions: boolean;
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
            {published
              ? "Logged-in members can fill this out via the link."
              : "Only lab staff can see this form."}
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

      {publicUrl && (
        <div className="flex items-center gap-2">
          <input
            readOnly
            value={publicUrl}
            onFocus={(e) => e.currentTarget.select()}
            className="flex-1 min-w-0 px-2 py-1.5 text-xs border border-border rounded-md bg-background text-foreground font-mono"
          />
          <button
            type="button"
            onClick={copy}
            className="inline-flex items-center gap-1 px-2 py-1.5 text-xs border border-border rounded-md text-foreground hover:bg-muted/50 transition-colors"
          >
            {copied ? (
              <>
                <Check className="w-3.5 h-3.5" /> Copied
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" /> Copy
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
}
