import { useState } from "react";
import { Form, useLoaderData } from "react-router";
import { Plus, Clock, UserIcon, Pencil } from "lucide-react";
import type { loader } from "~/hiring/routes/confidentiality-agreements.$id";
import { DocEditor } from "~/components/doc";
import { isEmptyBody } from "~/lib/signing-fields";
import { formatDateTime, fullName, UNKNOWN_LABEL } from "~/lib/display";
import { useUserTimeZone } from "~/hooks/useUserTimeZone";

export function ConfidentialityAgreementDetail() {
  const { agreement, canEdit } = useLoaderData<typeof loader>();
  const tz = useUserTimeZone();

  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(
    agreement.versions[0]?.id ?? null,
  );
  const [isCreatingVersion, setIsCreatingVersion] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);

  const selectedVersion =
    agreement.versions.find((v) => v.id === selectedVersionId) ?? null;

  // Bodies arrive from the loader as BlockNote block JSON (legacy rows are
  // converted on read) — a new version starts from the converted blocks.
  const [draftBody, setDraftBody] = useState<unknown>(selectedVersion?.body ?? []);
  const [draftName, setDraftName] = useState(agreement.name);

  const handleStartCreate = () => {
    setDraftBody(selectedVersion?.body ?? []);
    setIsCreatingVersion(true);
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          {isRenaming ? (
            <Form
              method="post"
              className="flex items-center gap-2"
              onSubmit={() => setIsRenaming(false)}
            >
              <input type="hidden" name="intent" value="rename" />
              <input
                type="text"
                name="name"
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                className="px-3 py-2 text-base text-foreground border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-[16rem]"
                autoFocus
              />
              <button
                type="submit"
                className="px-3 py-2 text-sm font-medium text-white bg-accent-coral rounded-md hover:bg-accent-coral/90"
              >
                Save
              </button>
              <button
                type="button"
                onClick={() => {
                  setDraftName(agreement.name);
                  setIsRenaming(false);
                }}
                className="px-3 py-2 text-sm font-medium text-foreground/80 bg-card border border-gray-300 rounded-md hover:bg-muted/50"
              >
                Cancel
              </button>
            </Form>
          ) : (
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-foreground">
                {agreement.name}
              </h1>
              {canEdit && (
                <button
                  type="button"
                  onClick={() => setIsRenaming(true)}
                  className="text-muted-foreground/70 hover:text-foreground"
                  aria-label="Rename agreement"
                >
                  <Pencil className="w-4 h-4" />
                </button>
              )}
            </div>
          )}
          <p className="mt-1 text-sm text-muted-foreground">
            {agreement.versions.length} version
            {agreement.versions.length !== 1 ? "s" : ""}
          </p>
        </div>

        {canEdit && !isCreatingVersion && (
          <button
            type="button"
            onClick={handleStartCreate}
            className="inline-flex items-center px-4 py-2 text-sm font-medium rounded-lg text-white bg-accent-coral hover:bg-accent-coral/90 shadow-sm"
          >
            <Plus className="w-4 h-4 mr-2" />
            New Version
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[16rem_1fr] gap-6">
        <aside className="space-y-2">
          <h2 className="text-sm font-semibold text-foreground/80 uppercase tracking-wide">
            Versions
          </h2>
          {agreement.versions.length === 0 && (
            <p className="text-sm text-muted-foreground italic">
              No versions yet.
            </p>
          )}
          {agreement.versions.map((v) => {
            const active = v.id === selectedVersionId && !isCreatingVersion;
            return (
              <button
                key={v.id}
                type="button"
                onClick={() => {
                  setSelectedVersionId(v.id);
                  setIsCreatingVersion(false);
                }}
                className={`w-full text-left rounded-lg border px-3 py-2 transition ${
                  active
                    ? "border-blue-500 bg-blue-50 text-blue-900"
                    : "border-border bg-card hover:bg-muted/40 text-foreground"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium">v{v.versionNumber}</span>
                  <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {formatDateTime(v.createdAt, tz)}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-1 inline-flex items-center gap-1 truncate">
                  <UserIcon className="w-3 h-3 shrink-0" />
                  {v.createdBy ? fullName(v.createdBy) || UNKNOWN_LABEL : UNKNOWN_LABEL}
                </p>
              </button>
            );
          })}
        </aside>

        <section className="bg-card rounded-xl border border-border p-6 shadow-sm">
          {isCreatingVersion ? (
            <Form
              method="post"
              className="space-y-4"
              onSubmit={() => setIsCreatingVersion(false)}
            >
              <input type="hidden" name="intent" value="create-version" />
              <input
                type="hidden"
                name="body"
                value={JSON.stringify(draftBody)}
              />
              <div>
                <label className="block text-sm font-medium text-foreground/80 mb-1">
                  Body
                </label>
                <div className="rounded-lg border border-border bg-card">
                  <DocEditor
                    features="agreement"
                    signing={{ mode: "author" }}
                    initialContent={draftBody}
                    onChange={setDraftBody}
                    placeholder="Write the confidentiality agreement…"
                    className="py-2"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsCreatingVersion(false)}
                  className="px-3 py-2 text-sm font-medium text-foreground/80 bg-card border border-gray-300 rounded-md hover:bg-muted/50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isEmptyBody(draftBody)}
                  className="px-3 py-2 text-sm font-medium text-white bg-accent-coral rounded-md hover:bg-accent-coral/90 disabled:opacity-50"
                >
                  Save Version
                </button>
              </div>
            </Form>
          ) : selectedVersion ? (
            <div className="space-y-4">
              <DocEditor
                key={selectedVersion.id}
                features="agreement"
                editable={false}
                initialContent={selectedVersion.body}
                signing={{ mode: "view" }}
              />
              {isEmptyBody(selectedVersion.body) && (
                <p className="text-sm text-muted-foreground italic">
                  This version has no content.
                </p>
              )}
            </div>
          ) : (
            <div className="text-center py-12">
              <p className="text-muted-foreground italic">
                No versions yet. Click "New Version" to create one.
              </p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
