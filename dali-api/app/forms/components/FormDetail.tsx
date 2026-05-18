import { useState, useEffect, useRef } from "react";
import { Link, useLoaderData, useSubmit, useFetcher } from "react-router";
import {
  ArrowLeft,
  Plus,
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

// Editor page for a single form. Mirrors hiring's ChallengeDetail: a versions
// sidebar on the left, the hiring FormBuilderTab on the right when creating a
// version, and a read-only preview of the selected version otherwise. Saving
// appends a new immutable version (handled by the route action).
export function FormDetail() {
  const { form, backTo } = useLoaderData<typeof loader>();
  const submit = useSubmit();

  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(
    () =>
      form.versions.length
        ? form.versions[form.versions.length - 1].id
        : null,
  );
  const [isCreatingVersion, setIsCreatingVersion] = useState(
    form.versions.length === 0,
  );

  const selectedVersion = form.versions.find(
    (v) => v.id === selectedVersionId,
  );
  const nextVersionNumber = form.versions.length + 1;

  // After a save round-trips and the loader re-runs, select the new version
  // and leave create mode.
  const prevCount = useRef(form.versions.length);
  useEffect(() => {
    if (form.versions.length > prevCount.current) {
      setSelectedVersionId(form.versions[form.versions.length - 1].id);
      setIsCreatingVersion(false);
    }
    prevCount.current = form.versions.length;
  }, [form.versions.length]);

  function handleSave({
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
    submit(fd, { method: "post" });
  }

  return (
    <div className="space-y-6">
      <div>
        <Link
          to={backTo}
          className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground/80 mb-4"
        >
          <ArrowLeft className="w-4 h-4 mr-1" /> Back to Forms
        </Link>
        <div className="flex justify-between items-start">
          <div>
            <h1 className="text-2xl font-bold text-foreground">{form.name}</h1>
            <p className="mt-1 text-muted-foreground">
              Created {new Date(form.createdAt).toLocaleDateString()}
            </p>
          </div>
          {!isCreatingVersion && (
            <button
              onClick={() => setIsCreatingVersion(true)}
              className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-lg text-white bg-blue-600 hover:bg-blue-700 shadow-sm"
            >
              <Plus className="w-4 h-4 mr-2" />
              New Version
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
        {/* Left: versions list */}
        <div className="w-full lg:w-64 flex-shrink-0 space-y-4">
          <h3 className="text-sm font-bold text-foreground uppercase tracking-wider">
            Versions
          </h3>
          {form.versions.length === 0 ? (
            <p className="text-sm text-muted-foreground">No versions yet.</p>
          ) : (
            <div className="space-y-2">
              {[...form.versions].reverse().map((version) => (
                <button
                  key={version.id}
                  onClick={() => {
                    setSelectedVersionId(version.id);
                    setIsCreatingVersion(false);
                  }}
                  className={`w-full text-left p-4 rounded-xl border transition-colors ${
                    selectedVersionId === version.id && !isCreatingVersion
                      ? "border-blue-500 bg-blue-50 ring-1 ring-blue-500"
                      : "border-border bg-card hover:bg-muted/50"
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <span className="font-medium text-foreground">
                        v{version.versionNumber}
                      </span>
                      <p className="text-sm text-muted-foreground">
                        {version.questions.length} questions
                      </p>
                    </div>
                    <div className="text-right">
                      <div className="flex items-center justify-end text-xs text-muted-foreground mb-0.5">
                        <Clock className="w-3 h-3 mr-1 flex-shrink-0" />
                        {formatDateTime(version.createdAt)}
                      </div>
                      <div className="flex items-center justify-end text-xs text-muted-foreground">
                        <UserIcon className="w-3 h-3 mr-1 flex-shrink-0" />
                        {version.createdByName}
                      </div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Right: builder or preview */}
        <div className="flex-1">
          {isCreatingVersion ? (
            <div className="bg-card rounded-xl border border-border shadow-sm p-6">
              <div className="mb-6 pb-6 border-b border-border">
                <h2 className="text-lg font-bold text-foreground">
                  {form.versions.length === 0
                    ? "Build this form"
                    : "Create New Version"}
                </h2>
                <p className="text-sm text-muted-foreground mt-1">
                  It will be saved as v{nextVersionNumber}. Anyone filling this
                  out sees the latest version.
                </p>
              </div>
              <FormBuilderTab
                initialQuestions={selectedVersion?.questions ?? []}
                initialDescription={selectedVersion?.description ?? null}
                onSave={handleSave}
                onCancel={
                  form.versions.length === 0
                    ? undefined
                    : () => setIsCreatingVersion(false)
                }
              />
            </div>
          ) : selectedVersion ? (
            <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
              <div className="px-6 py-5 border-b border-border bg-muted/50 flex justify-between items-center">
                <div>
                  <h2 className="text-lg font-semibold text-foreground">
                    Version {selectedVersion.versionNumber} Preview
                  </h2>
                  <p className="text-sm text-muted-foreground mt-1">
                    Created by {selectedVersion.createdByName} on{" "}
                    {formatDateTime(selectedVersion.createdAt)}
                  </p>
                </div>
                <button
                  onClick={() => setIsCreatingVersion(true)}
                  className="text-sm text-blue-600 hover:text-blue-700 font-medium"
                >
                  Duplicate to New Version
                </button>
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
                                className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-50 text-blue-700 border border-blue-100"
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
                  onClick={() => setIsCreatingVersion(true)}
                  className="inline-flex items-center px-4 py-2 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700"
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

// Publish toggle + shareable public link. A published form is fillable from
// outside dali-api (no login) at /f/:publicToken; unpublishing 404s that
// route but keeps the token so re-publishing restores the same link.
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
      ? `${typeof window !== "undefined" ? window.location.origin : ""}/f/${publicToken}`
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
              ? "Anyone with the link can fill this out — no login."
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
