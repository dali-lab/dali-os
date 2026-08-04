import { useState } from "react";
import { Form, Link, useLoaderData } from "react-router";
import {
  Plus,
  Clock,
  User as UserIcon,
  Pencil,
  CheckCircle2,
  Circle,
  Zap,
  Archive,
  PenLine,
} from "lucide-react";
import {
  DocEditor,
  insertSigningField,
  insertVariable,
  type DocEditorInstance,
} from "~/components/doc";
import { useConfirmSubmit } from "~/components/ui/dialog";
import {
  FIELD_LABEL,
  SIGNING_FIELD_TYPES,
  isEmptyBody,
  type SigningFieldType,
} from "~/lib/signing-fields";
import { ALL_SIGNING_VARIABLES } from "~/lib/signing-variables";
import { formatDateTime, fullName, UNKNOWN_LABEL } from "~/lib/display";
import { useUserTimeZone } from "~/hooks/useUserTimeZone";
import type { loader } from "~/signing/routes/admin.agreements.$id";

function asRoles(raw: unknown): string[] {
  return Array.isArray(raw) ? (raw as string[]) : [];
}

// Sample values for "Preview as signer" — matches the legacy preview.
function previewVariables(): Record<string, string> {
  return {
    term: "26S",
    today: new Date().toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    }),
    memberName: "Jane Member",
    supervisorName: "DALI Staff",
  };
}

// Insert-field controls for authoring, ported from the legacy toolbar's
// SigningInsertControls: pick the signer role, drop a field for it, or insert
// a merge variable — all at the caret via the live editor instance.
function SigningInsertControls({
  editor,
  roles,
}: {
  editor: DocEditorInstance | null;
  roles: string[];
}) {
  const [role, setRole] = useState(roles[0] ?? "member");
  // The roles input is live-editable while the controls are mounted — never
  // insert a role that's no longer in the list.
  const effectiveRole = roles.includes(role) ? role : (roles[0] ?? "member");

  const insertField = (type: SigningFieldType) => {
    if (!editor) return;
    editor.focus();
    insertSigningField(editor, { type, role: effectiveRole });
  };

  const handleVariable = (name: string) => {
    if (!editor || !name) return;
    editor.focus();
    insertVariable(editor, name);
  };

  return (
    <div className="flex flex-wrap items-center gap-1 border-b border-border px-2 py-1.5">
      <span className="text-xs font-medium text-muted-foreground mr-1">Insert:</span>
      <select
        value={effectiveRole}
        onChange={(e) => setRole(e.target.value)}
        title="Signer role for inserted fields"
        className="rounded border border-border bg-card px-1.5 py-1 text-xs text-foreground"
      >
        {roles.map((r) => (
          <option key={r} value={r}>
            {r}
          </option>
        ))}
      </select>
      {SIGNING_FIELD_TYPES.map((type) => (
        <button
          key={type}
          type="button"
          disabled={!editor}
          title={`Insert ${FIELD_LABEL[type]} field (${effectiveRole})`}
          onMouseDown={(e) => {
            e.preventDefault();
            insertField(type);
          }}
          className="rounded px-1.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
        >
          {FIELD_LABEL[type]}
        </button>
      ))}
      <select
        value=""
        disabled={!editor}
        onChange={(e) => {
          handleVariable(e.target.value);
          e.currentTarget.value = "";
        }}
        title="Insert a merge variable"
        className="rounded border border-border bg-card px-1.5 py-1 text-xs text-muted-foreground disabled:opacity-40"
      >
        <option value="">+ Variable</option>
        {ALL_SIGNING_VARIABLES.map((v) => (
          <option key={v} value={v}>
            {`{{${v}}}`}
          </option>
        ))}
      </select>
    </div>
  );
}

export function SigningDocumentDetail() {
  const { document, isAdmin } = useLoaderData<typeof loader>();
  const tz = useUserTimeZone();
  const confirmSubmit = useConfirmSubmit();

  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(
    document.versions[0]?.id ?? null,
  );
  const [isCreating, setIsCreating] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [draftName, setDraftName] = useState(document.name);
  const [editorInstance, setEditorInstance] = useState<DocEditorInstance | null>(null);

  const selectedVersion =
    document.versions.find((v) => v.id === selectedVersionId) ?? null;

  const prevRoles = asRoles(selectedVersion?.roles);
  // Bodies arrive from the loader as BlockNote block JSON (legacy PM rows are
  // converted on read) — a new version authored from an old one starts from
  // the converted blocks.
  const [draftBody, setDraftBody] = useState<unknown>(selectedVersion?.body ?? []);
  const [rolesText, setRolesText] = useState(
    prevRoles.length ? prevRoles.join(", ") : "member, supervisor",
  );

  const editorRoles = rolesText
    .split(",")
    .map((r) => r.trim())
    .filter(Boolean);

  const startCreate = () => {
    setDraftBody(selectedVersion?.body ?? []);
    setRolesText(prevRoles.length ? prevRoles.join(", ") : "member, supervisor");
    setIsCreating(true);
    setPreviewing(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          {isRenaming ? (
            <Form method="post" className="flex items-center gap-2" onSubmit={() => setIsRenaming(false)}>
              <input type="hidden" name="intent" value="rename" />
              <input
                type="text"
                name="name"
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                className="px-3 py-2 text-base border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-accent-coral min-w-[18rem]"
                autoFocus
              />
              <button type="submit" className="px-3 py-2 text-sm font-medium text-white bg-accent-coral rounded-md hover:bg-accent-coral/90">
                Save
              </button>
              <button
                type="button"
                onClick={() => {
                  setDraftName(document.name);
                  setIsRenaming(false);
                }}
                className="px-3 py-2 text-sm font-medium text-foreground/80 bg-card border border-gray-300 rounded-md hover:bg-muted/50"
              >
                Cancel
              </button>
            </Form>
          ) : (
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-foreground">{document.name}</h1>
              <button
                type="button"
                onClick={() => setIsRenaming(true)}
                className="text-muted-foreground/70 hover:text-foreground"
                aria-label="Rename agreement"
              >
                <Pencil className="w-4 h-4" />
              </button>
            </div>
          )}
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="rounded bg-muted px-2 py-0.5">{document.kind}</span>
            <span className="rounded bg-muted px-2 py-0.5">scope: {document.gateScope}</span>
            <span className="rounded bg-muted px-2 py-0.5">audience: {document.audience}</span>
            <span className="rounded bg-muted px-2 py-0.5">slug: {document.slug}</span>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {!isCreating && (
            <button
              type="button"
              onClick={startCreate}
              className="inline-flex items-center px-4 py-2 text-sm font-medium rounded-lg text-white bg-accent-coral hover:bg-accent-coral/90 shadow-sm"
            >
              <Plus className="w-4 h-4 mr-2" />
              New Version
            </button>
          )}
          <Form
            method="post"
            onSubmit={confirmSubmit({
              title: "Archive this agreement?",
              tone: "destructive",
              confirmLabel: "Archive",
            })}
          >
            <input type="hidden" name="intent" value="archive" />
            <button
              type="submit"
              className="inline-flex items-center px-3 py-2 text-sm font-medium rounded-lg text-foreground/70 bg-card border border-border hover:bg-muted/50"
              title="Archive"
            >
              <Archive className="w-4 h-4" />
            </button>
          </Form>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[16rem_1fr] gap-6">
        <aside className="space-y-2">
          <h2 className="text-sm font-semibold text-foreground/80 uppercase tracking-wide">Versions</h2>
          {document.versions.length === 0 && (
            <p className="text-sm text-muted-foreground italic">No versions yet.</p>
          )}
          {document.versions.map((v) => {
            const active = v.id === selectedVersionId && !isCreating;
            return (
              <button
                key={v.id}
                type="button"
                onClick={() => {
                  setSelectedVersionId(v.id);
                  setIsCreating(false);
                }}
                className={`w-full text-left rounded-lg border px-3 py-2 transition ${
                  active
                    ? "border-accent-coral bg-accent-coral/5 text-foreground"
                    : "border-border bg-card hover:bg-muted/40 text-foreground"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium">v{v.versionNumber}</span>
                  {v.publishedAt ? (
                    <span className="text-xs text-green-600 inline-flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" /> published
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
                      <Circle className="w-3 h-3" /> draft
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-1 inline-flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {formatDateTime(v.createdAt, tz)}
                </p>
                <p className="text-xs text-muted-foreground inline-flex items-center gap-1 truncate">
                  <UserIcon className="w-3 h-3 shrink-0" />
                  {v.createdBy ? fullName(v.createdBy) || UNKNOWN_LABEL : UNKNOWN_LABEL}
                </p>
              </button>
            );
          })}
        </aside>

        <section className="space-y-6">
          <div className="bg-card rounded-xl border border-border p-6 shadow-sm">
            {isCreating ? (
              <Form method="post" className="space-y-4" onSubmit={() => setIsCreating(false)}>
                <input type="hidden" name="intent" value="create-version" />
                <input type="hidden" name="body" value={JSON.stringify(draftBody)} />
                <label className="block text-sm">
                  <span className="font-medium text-foreground/80">Signer roles (comma-separated)</span>
                  <input
                    type="text"
                    name="roles"
                    value={rolesText}
                    onChange={(e) => setRolesText(e.target.value)}
                    placeholder="member, supervisor"
                    className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-accent-coral"
                  />
                  <span className="mt-1 block text-xs text-muted-foreground">
                    The "supervisor" role is the fixed staff counter-signature applied once per binding.
                  </span>
                </label>
                <div>
                  <div className="mb-1 flex items-center justify-between">
                    <label className="block text-sm font-medium text-foreground/80">Body</label>
                    <button
                      type="button"
                      onClick={() => setPreviewing((p) => !p)}
                      className="text-xs font-medium text-accent-coral hover:underline"
                    >
                      {previewing ? "← Back to editing" : "Preview as signer"}
                    </button>
                  </div>
                  {previewing ? (
                    <div className="rounded-lg border border-border bg-card p-6">
                      <DocEditor
                        features="agreement"
                        editable={false}
                        initialContent={draftBody}
                        signing={{ mode: "view", variables: previewVariables() }}
                      />
                      <p className="mt-4 text-xs text-muted-foreground italic">
                        Preview with sample values — signature/date/checkbox fields appear as blank
                        lines here and become fillable for the signer.
                      </p>
                    </div>
                  ) : (
                    <div className="rounded-lg border border-border bg-card">
                      <SigningInsertControls
                        editor={editorInstance}
                        roles={editorRoles.length ? editorRoles : ["member"]}
                      />
                      <DocEditor
                        features="agreement"
                        signing={{ mode: "author" }}
                        initialContent={draftBody}
                        onChange={setDraftBody}
                        onEditorReady={setEditorInstance}
                        placeholder="Write the agreement… use the Insert controls to place signature/date/checkbox fields and {{term}} variables."
                        className="py-2"
                      />
                    </div>
                  )}
                </div>
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setIsCreating(false)}
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
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm text-muted-foreground">
                    v{selectedVersion.versionNumber} · roles: {asRoles(selectedVersion.roles).join(", ") || "member"}
                  </p>
                  <div className="flex items-center gap-2">
                    {!selectedVersion.publishedAt && (
                      <Form method="post">
                        <input type="hidden" name="intent" value="publish" />
                        <input type="hidden" name="versionId" value={selectedVersion.id} />
                        <button
                          type="submit"
                          className="inline-flex items-center gap-1 px-3 py-1.5 text-sm font-medium rounded-md text-white bg-green-600 hover:bg-green-700"
                        >
                          <CheckCircle2 className="w-4 h-4" /> Publish
                        </button>
                      </Form>
                    )}
                    {selectedVersion.publishedAt && (
                      <Form method="post">
                        <input type="hidden" name="intent" value="activate" />
                        <input type="hidden" name="versionId" value={selectedVersion.id} />
                        <button
                          type="submit"
                          className="inline-flex items-center gap-1 px-3 py-1.5 text-sm font-medium rounded-md text-white bg-accent-coral hover:bg-accent-coral/90"
                          title="Put this version in force"
                        >
                          <Zap className="w-4 h-4" /> Put in force
                        </button>
                      </Form>
                    )}
                  </div>
                </div>
                <DocEditor
                  key={selectedVersion.id}
                  features="agreement"
                  editable={false}
                  initialContent={selectedVersion.body}
                  signing={{ mode: "view" }}
                />
                {isEmptyBody(selectedVersion.body) && (
                  <p className="text-sm text-muted-foreground italic">This version has no content.</p>
                )}
              </div>
            ) : (
              <div className="text-center py-12">
                <p className="text-muted-foreground italic">
                  No versions yet. Click "New Version" to author the agreement.
                </p>
              </div>
            )}
          </div>

          <BindingsPanel />
        </section>
      </div>
    </div>
  );
}

function BindingsPanel() {
  const { document, rosters } = useLoaderData<typeof loader>();
  if (document.bindings.length === 0) {
    return (
      <div className="bg-card rounded-xl border border-border p-6 shadow-sm">
        <h3 className="text-sm font-semibold text-foreground/80 uppercase tracking-wide">In force</h3>
        <p className="mt-2 text-sm text-muted-foreground italic">
          Not in force anywhere yet. Publish a version and click "Put in force".
        </p>
      </div>
    );
  }
  const anyPending = document.bindings.some(
    (b) => !b.signatures.some((s) => s.roleKey === "supervisor"),
  );
  return (
    <div className="bg-card rounded-xl border border-border p-6 shadow-sm space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-foreground/80 uppercase tracking-wide">
          In force &amp; signatories
        </h3>
        {anyPending && (
          <Form method="post">
            <input type="hidden" name="intent" value="countersign-all" />
            <button
              type="submit"
              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-md text-white bg-dark-blue hover:opacity-90"
            >
              <PenLine className="w-3.5 h-3.5" /> Counter-sign all as supervisor
            </button>
          </Form>
        )}
      </div>
      {document.bindings.map((b) => {
        const context =
          b.cycle?.name ? `cycle: ${b.cycle.name}` : b.term?.code ? `term: ${b.term.code}` : "app-wide";
        const supervisorSigned = b.signatures.some((s) => s.roleKey === "supervisor");
        const roster = rosters[b.id];
        return (
          <div key={b.id} className="rounded-lg border border-border p-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-medium text-foreground">
                {context} · v{b.version.versionNumber}
              </p>
              {!supervisorSigned && (
                <Form method="post">
                  <input type="hidden" name="intent" value="countersign" />
                  <input type="hidden" name="bindingId" value={b.id} />
                  <button
                    type="submit"
                    className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-md text-white bg-dark-blue hover:opacity-90"
                  >
                    <PenLine className="w-3.5 h-3.5" /> Counter-sign as supervisor
                  </button>
                </Form>
              )}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Supervisor: {supervisorSigned ? "signed ✓" : "pending"}
              {roster.outstanding !== null
                ? ` · ${roster.signed.length} of ${roster.signed.length + roster.outstanding.length} signed`
                : ` · ${roster.signed.length} signature${roster.signed.length !== 1 ? "s" : ""}`}
            </p>

            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div>
                <p className="text-xs font-semibold text-green-700 mb-1">
                  Signed ({roster.signed.length})
                </p>
                <ul className="space-y-0.5 max-h-40 overflow-y-auto">
                  {roster.signed.length === 0 ? (
                    <li className="text-xs text-muted-foreground italic">No one yet.</li>
                  ) : (
                    roster.signed.map((s) => (
                      <li key={s.signatureId}>
                        <Link
                          to={`/admin/agreements/${document.id}/signature/${s.signatureId}`}
                          className="block truncate text-xs text-accent-coral hover:underline"
                          title="View signed copy"
                        >
                          {s.name}
                        </Link>
                      </li>
                    ))
                  )}
                </ul>
              </div>
              {roster.outstanding !== null && (
                <div>
                  <p className="text-xs font-semibold text-amber-700 mb-1">
                    Outstanding ({roster.outstanding.length})
                  </p>
                  <ul className="space-y-0.5 max-h-40 overflow-y-auto">
                    {roster.outstanding.length === 0 ? (
                      <li className="text-xs text-muted-foreground italic">Everyone signed 🎉</li>
                    ) : (
                      roster.outstanding.map((n) => (
                        <li key={n} className="text-xs text-muted-foreground truncate">
                          {n}
                        </li>
                      ))
                    )}
                  </ul>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
