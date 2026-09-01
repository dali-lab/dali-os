import { useEffect, useMemo, useRef, useState } from "react";
import { Form, Link, useLoaderData, useActionData, useSubmit } from "react-router";
import { Menu, Tooltip, InfoTip } from "~/components/ui/floating";
import { nextTermCode } from "~/lib/terms.shared";
import {
  Plus,
  Clock,
  ChevronDown,
  User as UserIcon,
  CheckCircle2,
  Circle,
  Zap,
  Archive,
  PenLine,
  Trash2,
  Send,
} from "lucide-react";
import {
  DocEditor,
  insertSigningField,
  insertVariable,
  insertAdminSignature,
  type DocEditorInstance,
} from "~/components/doc";
import { useConfirmSubmit, useDialog } from "~/components/ui/dialog";
import {
  ManagedEditorShell,
  RestoreVersionButton,
} from "~/components/editor/ManagedEditorShell";
import {
  FIELD_LABEL,
  SIGNING_FIELD_TYPES,
  isEmptyBody,
  type SigningFieldType,
} from "~/lib/signing-fields";
import { ALL_SIGNING_VARIABLES } from "~/lib/signing-variables";
import { formatDateTime, fullName, UNKNOWN_LABEL } from "~/lib/display";
import { useUserTimeZone } from "~/hooks/useUserTimeZone";
import {
  SCOPE_OPTIONS,
  AUDIENCE_OPTIONS,
  CADENCE_OPTIONS,
  SCOPE_SHORT,
  AUDIENCE_SHORT,
  CADENCE_SHORT,
} from "~/signing/lib/document-config";
import type { loader } from "~/signing/routes/core.agreements.$id";

// The signer fills these; the pre-signed supervisor signature is placed separately.
const MEMBER_FIELD_TYPES = SIGNING_FIELD_TYPES.filter(
  (t) => t !== "adminSignatureField",
);

// Tooltip copy for each field type shown in the insert controls.
const FIELD_TYPE_TIP: Partial<Record<string, string>> = {
  signatureField: "Member draws or types their signature.",
  dateField: "Auto-fills with the date the member signs.",
  initialField: "Member enters their initials — shorter than a full signature.",
  checkboxField: "Member checks a box to acknowledge a statement.",
  textField: "Member types a short freeform response.",
};

type PersonResult = { userId: string; name: string; email: string | null };

// "Supervisor signature" button: search the directory, pick a signatory, and drop a
// pre-signed signature field bound to them at the caret. Their name renders in
// the document immediately; issuance records the counter-signature.
function AdminSignatureButton({ editor }: { editor: DocEditorInstance | null }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<PersonResult[]>([]);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  useEffect(() => {
    if (!open || q.trim().length < 2) {
      setResults([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/agreements/people?q=${encodeURIComponent(q.trim())}`, {
          credentials: "include",
        });
        const json = (await res.json()) as { results?: PersonResult[] };
        if (!cancelled) setResults(json.results ?? []);
      } catch {
        if (!cancelled) setResults([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q, open]);

  const pick = (p: PersonResult) => {
    if (editor) {
      editor.focus();
      insertAdminSignature(editor, { userId: p.userId, name: p.name });
    }
    setOpen(false);
    setQ("");
    setResults([]);
  };

  return (
    <div className="relative" ref={containerRef}>
      <Tooltip content="Inserts a pre-signed supervisor counter-signature bound to a named person. Their name is baked into the document at issuance — the member never fills this field." variant="rich">
        <button
          type="button"
          disabled={!editor}
          onClick={() => setOpen((v) => !v)}
          className="inline-flex items-center gap-1 rounded border border-border bg-card px-1.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted/40 disabled:opacity-40"
        >
          <PenLine className="w-3 h-3" /> Supervisor signature
        </button>
      </Tooltip>
      {open && (
        <div className="absolute left-0 z-50 mt-1 w-72 rounded-md border border-border bg-card p-2 shadow-lg">
          <input
            autoFocus
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search a signatory by name or email…"
            className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
          />
          <div className="mt-2 flex max-h-64 flex-col gap-0.5 overflow-y-auto">
            {loading && <p className="px-1 py-1 text-xs text-muted-foreground">Searching…</p>}
            {!loading && q.trim().length >= 2 && results.length === 0 && (
              <p className="px-1 py-1 text-xs text-muted-foreground">No members found.</p>
            )}
            {results.map((p) => (
              <button
                key={p.userId}
                type="button"
                onClick={() => pick(p)}
                className="flex flex-col rounded px-2 py-1.5 text-left hover:bg-muted"
              >
                <span className="text-sm text-foreground">{p.name}</span>
                {p.email && <span className="text-[11px] text-muted-foreground">{p.email}</span>}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// Insert-field controls for authoring: drop a member field, place a pre-signed
// admin signature, or insert a merge variable — all at the caret via the live
// editor instance.
function SigningInsertControls({
  editor,
  examples,
}: {
  editor: DocEditorInstance | null;
  examples: Record<string, string>;
}) {
  const insertField = (type: SigningFieldType) => {
    if (!editor) return;
    editor.focus();
    insertSigningField(editor, { type, role: "member" });
  };

  const handleVariable = (name: string) => {
    if (!editor || !name) return;
    editor.focus();
    insertVariable(editor, name);
  };

  return (
    <div className="flex flex-wrap items-center gap-1 border-b border-border px-2 py-1.5">
      <span className="text-xs font-medium text-muted-foreground mr-1">Insert:</span>
      {MEMBER_FIELD_TYPES.map((type) => (
        <Tooltip key={type} content={FIELD_TYPE_TIP[type] ?? `Insert ${FIELD_LABEL[type]} field`}>
          <button
            type="button"
            disabled={!editor}
            onMouseDown={(e) => {
              e.preventDefault();
              insertField(type);
            }}
            className="rounded px-1.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
          >
            {FIELD_LABEL[type]}
          </button>
        </Tooltip>
      ))}
      <AdminSignatureButton editor={editor} />
      <Menu
        align="left"
        ariaLabel="Insert merge variable"
        trigger={
          <Tooltip content="Insert a {{variable}} that resolves at sign time — e.g. {{term}}, {{name}}, {{today}}.">
            <button
              type="button"
              disabled={!editor}
              className="inline-flex items-center gap-1 rounded border border-border bg-card px-1.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted/40 disabled:opacity-40"
            >
              + Variable
              <ChevronDown className="w-3 h-3" />
            </button>
          </Tooltip>
        }
      >
        {ALL_SIGNING_VARIABLES.map((v) => (
          <Menu.Item key={v} onSelect={() => handleVariable(v)}>
            <span className="font-mono">{`{{${v}}}`}</span>
            {examples[v] ? (
              <span className="ml-2 text-muted-foreground">→ {examples[v]}</span>
            ) : null}
          </Menu.Item>
        ))}
      </Menu>
    </div>
  );
}

export function SigningDocumentDetail() {
  const { document, variablePreview, currentTermCode, lockedVersionIds, collabToken, collabRoomName, collabUserName, currentUserId } =
    useLoaderData<typeof loader>();
  const actionData = useActionData<{ error?: string }>();
  const tz = useUserTimeZone();
  const confirmSubmit = useConfirmSubmit();
  const submit = useSubmit();
  const dialog = useDialog();
  const boundCount = document.bindings.length;

  // A version is editable/deletable in place while it's an unpublished draft
  // with no signatures. The newest such version is the live working draft the
  // collab room maps to; saving updates it rather than stacking a new version.
  const isEditableDraft = (v: { id: string; publishedAt: string | Date | null }) =>
    !v.publishedAt && !lockedVersionIds.includes(v.id);
  const tailDraftEditable = document.versions[0]
    ? isEditableDraft(document.versions[0])
    : false;

  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(
    document.versions[0]?.id ?? null,
  );
  const [isCreating, setIsCreating] = useState(false);
  const [draftName, setDraftName] = useState(document.name);
  const [previewing, setPreviewing] = useState(false);
  // Editor instance captured from onEditorReady — used by insert controls.
  const [editorInstance, setEditorInstance] = useState<DocEditorInstance | null>(null);

  // Preview term: an agreement is issued for a chosen term, and {{term}}
  // resolves to THAT term at sign time — so the author previews against the
  // term they'll issue for, not always the current one. Per-term agreements
  // usually go out for the upcoming term (issued before it starts), so default
  // there; everything else defaults to the current term. Options are a small
  // window forward from the current term (pure nextTermCode — no server call).
  const termOptions = useMemo(() => {
    if (!currentTermCode) return [] as { value: string; label: string }[];
    const codes: string[] = [];
    let c = currentTermCode;
    for (let i = 0; i < 4; i++) {
      codes.push(c);
      c = nextTermCode(c);
    }
    return codes.map((code) => ({ value: code, label: code }));
  }, [currentTermCode]);
  const [previewTermCode, setPreviewTermCode] = useState(
    currentTermCode
      ? document.cadence === "PerTerm"
        ? nextTermCode(currentTermCode)
        : currentTermCode
      : "",
  );
  // {{term}}/{{upcomingTerm}} follow the picked preview term; other sample
  // values (today, names) come from the loader unchanged.
  const previewVariables = useMemo(
    () => ({
      ...variablePreview,
      term: previewTermCode,
      upcomingTerm: previewTermCode ? nextTermCode(previewTermCode) : "",
    }),
    [variablePreview, previewTermCode],
  );

  const selectedVersion =
    document.versions.find((v) => v.id === selectedVersionId) ?? null;

  // Derive which version ids are currently bound ("in force") from the binding
  // data already loaded — no additional server call needed.
  const inForceVersionIds = new Set(document.bindings.map((b) => b.version.id));

  // Seed content for the collab room: the latest saved version body. When the
  // room is brand-new (no CollabDocument row yet), CollabDocInner seeds from
  // this after the provider syncs. On subsequent opens, the room already has
  // content and this seed is ignored.
  const latestVersionBody = document.versions[0]?.body ?? null;

  // "New version from vN" — puts the editor in draft mode. The collab room
  // already holds the working draft; this just surfaces the Save Version button.
  const startCreate = () => {
    setIsCreating(true);
    setPreviewing(false);
  };

  // Collect collab config once; stable for the page lifetime.
  const collabConfig =
    collabToken && collabRoomName && collabUserName
      ? {
          documentName: collabRoomName,
          token: collabToken,
          userName: collabUserName,
          userId: currentUserId,
          seedContent: latestVersionBody,
        }
      : null;

  // Version sidebar rendered inside ManagedEditorShell.
  const versionSidebar = (
    <>
      <h2 className="text-sm font-semibold text-foreground/80 uppercase tracking-wide">Versions</h2>
      {document.versions.length === 0 && (
        <p className="text-sm text-muted-foreground italic">No versions yet.</p>
      )}
      {document.versions.map((v) => {
        const active = v.id === selectedVersionId && !isCreating;
        return (
          <div key={v.id} className="group">
            <button
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
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">v{v.versionNumber}</span>
                <div className="flex items-center gap-1.5">
                  {inForceVersionIds.has(v.id) && (
                    <span className="text-xs text-accent-coral font-medium inline-flex items-center gap-1">
                      <Zap className="w-3 h-3" /> In force
                    </span>
                  )}
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
            {/* Restore this version into the collab working draft */}
            {collabConfig && !active && (
              <div className="mt-1 flex justify-end px-1">
                <RestoreVersionButton
                  onRestore={() => {
                    // Seed the collab room from this version by replacing the
                    // editor content — the editorInstance is available when the
                    // collab editor is mounted. We switch to draft mode so the
                    // Save Version button becomes visible.
                    if (editorInstance && v.body) {
                      editorInstance.replaceBlocks(
                        editorInstance.document,
                        // ensureBlocks has already run server-side; body is block JSON.
                        v.body as Parameters<typeof editorInstance.replaceBlocks>[1],
                      );
                      setIsCreating(true);
                      setPreviewing(false);
                    }
                  }}
                />
              </div>
            )}
          </div>
        );
      })}
    </>
  );

  // Apply a single config facet chosen from a pill dropdown. When bindings are
  // already in force, confirm first — the change re-scopes who must sign
  // immediately. On success the action redirects back here and the loader
  // reruns, so the pill reflects the new value.
  async function changeConfig(
    field: "gateScope" | "audience" | "cadence",
    value: string,
  ) {
    if (value === document[field]) return;
    if (boundCount > 0) {
      const ok = await dialog.confirm({
        title: "Re-scope this live agreement?",
        description: `This agreement has ${boundCount} binding${
          boundCount !== 1 ? "s" : ""
        } in force — changing this takes effect immediately for everyone in the new audience.`,
        confirmLabel: "Change",
      });
      if (!ok) return;
    }
    submit({ intent: "update", [field]: value }, { method: "post" });
  }

  // Editable config pills (enforcement / audience / cadence) + read-only slug.
  const metaBadges = (
    <>
      <ConfigPill
        label="Enforcement"
        value={SCOPE_SHORT[document.gateScope] ?? document.gateScope}
        selected={document.gateScope}
        options={SCOPE_OPTIONS}
        onSelect={(v) => changeConfig("gateScope", v)}
      />
      <span className="inline-flex items-center gap-1">
        <ConfigPill
          label="Audience"
          value={AUDIENCE_SHORT[document.audience] ?? document.audience}
          selected={document.audience}
          options={AUDIENCE_OPTIONS}
          onSelect={(v) => changeConfig("audience", v)}
        />
        <InfoTip content="Who must sign. New Members = first term staffed; Members = everyone currently staffed; Mentors = P3 + external mentors; Hiring Participants = anyone in an active hiring cycle." />
      </span>
      <ConfigPill
        label="Cadence"
        value={CADENCE_SHORT[document.cadence] ?? document.cadence}
        selected={document.cadence}
        options={CADENCE_OPTIONS}
        onSelect={(v) => changeConfig("cadence", v)}
      />
      <span className="rounded bg-muted px-2 py-0.5">slug: {document.slug}</span>
    </>
  );

  // Header actions
  const headerActions = (
    <>
      {!isCreating && (
        <button
          type="button"
          onClick={startCreate}
          className="inline-flex items-center px-4 py-2 text-sm font-medium rounded-lg text-white bg-accent-coral hover:bg-accent-coral/90 shadow-sm"
        >
          {tailDraftEditable ? (
            <PenLine className="w-4 h-4 mr-2" />
          ) : (
            <Plus className="w-4 h-4 mr-2" />
          )}
          {tailDraftEditable ? "Edit draft" : "New Version"}
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
        <Tooltip content="Archive">
          <button
            type="submit"
            aria-label="Archive"
            className="inline-flex items-center px-3 py-2 text-sm font-medium rounded-lg text-foreground/70 bg-card border border-border hover:bg-muted/50"
          >
            <Archive className="w-4 h-4" />
          </button>
        </Tooltip>
      </Form>
    </>
  );

  return (
    <ManagedEditorShell
      name={document.name}
      rename={{
        name: draftName,
        renameIntent: "rename",
        renameError: actionData?.error,
        onRename: setDraftName,
      }}
      metaBadges={metaBadges}
      headerActions={headerActions}
      versionSidebar={versionSidebar}
      isDrafting={isCreating}
      footer={<BindingsPanel />}
    >
      <div className="bg-card rounded-xl border border-border p-6 shadow-sm">
        {isCreating ? (
          // Draft editor — the collab room is the live body buffer. Save snapshots
          // the room server-side (no body post): it updates the tail draft in
          // place when one is still editable, else appends a new version.
          <Form method="post" className="space-y-4" onSubmit={() => setIsCreating(false)}>
            <input type="hidden" name="intent" value="save-version" />
            <input type="hidden" name="roles" value="member" />
            <div>
              <div className="mb-1 flex items-center justify-between">
                <label className="block text-sm font-medium text-foreground/80">Body</label>
                <div className="flex items-center gap-3 text-xs">
                  {termOptions.length > 0 && (
                    <ConfigPill
                      label="Preview term"
                      value={previewTermCode || "—"}
                      selected={previewTermCode}
                      options={termOptions}
                      onSelect={setPreviewTermCode}
                    />
                  )}
                  <button
                    type="button"
                    onClick={() => setPreviewing((p) => !p)}
                    className="font-medium text-accent-coral hover:underline"
                  >
                    {previewing ? "← Back to editing" : "Preview as signer"}
                  </button>
                </div>
              </div>
              {previewing ? (
                <div className="rounded-lg border border-border bg-card p-6">
                  {/* Read-only local-mode preview: snapshot from the collab editor
                      instance if available, otherwise render the last saved version. */}
                  <DocEditor
                    features="agreement"
                    editable={false}
                    initialContent={
                      editorInstance
                        ? editorInstance.document
                        : (selectedVersion?.body ?? [])
                    }
                    signing={{ mode: "view", variables: previewVariables }}
                  />
                  <p className="mt-4 text-xs text-muted-foreground italic">
                    Preview with sample values — {"{{term}}"} resolves to{" "}
                    {previewTermCode || "the selected term"} (the term you issue for) and dates to
                    today; signature, initials, text, and checkbox fields show as labeled
                    placeholders (the date auto-fills) and become fillable for the signer.
                  </p>
                </div>
              ) : (
                <div className="rounded-lg border border-border bg-card">
                  <SigningInsertControls editor={editorInstance} examples={previewVariables} />
                  {collabConfig ? (
                    // Collab mode: the Y.Doc is the source of truth.
                    // Room is seeded from latestVersionBody on first open (see
                    // collabConfig.seedContent); Save Version reads the room
                    // server-side via readDocAsBlocks — no body form post needed.
                    <DocEditor
                      features="agreement"
                      signing={{ mode: "author" }}
                      collab={collabConfig}
                      onEditorReady={setEditorInstance}
                      placeholder="Write the agreement… use the Insert controls to place signature/date/checkbox fields and {{term}} variables."
                      className="py-2"
                    />
                  ) : (
                    // Fallback: no session cookie (should not occur for Core users).
                    <p className="px-4 py-6 text-sm text-muted-foreground italic">
                      Editor unavailable — please refresh to restore your session.
                    </p>
                  )}
                </div>
              )}
            </div>
            {actionData?.error && (
              <p className="text-xs text-red-600">{actionData.error}</p>
            )}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsCreating(false)}
                className="px-3 py-2 text-sm font-medium text-foreground/80 bg-card border border-border rounded-md hover:bg-muted/50"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-3 py-2 text-sm font-medium text-white bg-accent-coral rounded-md hover:bg-accent-coral/90 disabled:opacity-50"
              >
                {tailDraftEditable ? "Save draft" : "Save Version"}
              </button>
            </div>
          </Form>
        ) : selectedVersion ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-muted-foreground">
                v{selectedVersion.versionNumber}
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
                {selectedVersion.publishedAt && (() => {
                  const alreadyInForce = inForceVersionIds.has(selectedVersion.id);
                  if (alreadyInForce) {
                    // This version is already bound — show its state and offer a
                    // targeted re-send to whoever hasn't signed yet (same activate
                    // intent; the server skips already-signed members).
                    return (
                      <>
                        <Tooltip content="This version is already in force. Signatories are tracked in the panel below." variant="rich">
                          <span className="inline-flex items-center gap-1 px-3 py-1.5 text-sm font-medium rounded-md text-accent-coral bg-accent-coral/10 border border-accent-coral/30 cursor-default select-none">
                            <Zap className="w-4 h-4" /> In force
                          </span>
                        </Tooltip>
                        <Form
                          method="post"
                          onSubmit={confirmSubmit({
                            title: "Re-send sign requests to unsigned members?",
                            description: `A sign request will be sent to everyone in the configured audience who has not yet signed this version.`,
                            confirmLabel: "Re-send",
                          })}
                        >
                          <input type="hidden" name="intent" value="activate" />
                          <input type="hidden" name="versionId" value={selectedVersion.id} />
                          <Tooltip content="Send a sign request to everyone in the audience who hasn't signed yet — already-signed members are skipped." variant="rich">
                            <button
                              type="submit"
                              className="inline-flex items-center gap-1 px-3 py-1.5 text-sm font-medium rounded-md text-foreground/70 bg-card border border-border hover:bg-muted/50"
                            >
                              <Send className="w-4 h-4" /> Re-send to unsigned
                            </button>
                          </Tooltip>
                        </Form>
                      </>
                    );
                  }
                  return (
                    <Form
                      method="post"
                      onSubmit={confirmSubmit({
                        title: "Put in force & send sign requests?",
                        description: `"${document.name}" will be put in force and a sign request will be sent to everyone in the configured audience.`,
                        confirmLabel: "Send",
                      })}
                    >
                      <input type="hidden" name="intent" value="activate" />
                      <input type="hidden" name="versionId" value={selectedVersion.id} />
                      <Tooltip content="Bind this version: send sign requests to everyone in the configured audience and start tracking completion." variant="rich">
                        <button
                          type="submit"
                          className="inline-flex items-center gap-1 px-3 py-1.5 text-sm font-medium rounded-md text-white bg-accent-coral hover:bg-accent-coral/90"
                        >
                          <Zap className="w-4 h-4" /> Put in force
                        </button>
                      </Tooltip>
                    </Form>
                  );
                })()}
                {isEditableDraft(selectedVersion) && (
                  <Form
                    method="post"
                    onSubmit={confirmSubmit({
                      title: "Delete this draft version?",
                      description: "This draft has never been published or signed, so it can be removed.",
                      tone: "destructive",
                      confirmLabel: "Delete",
                    })}
                  >
                    <input type="hidden" name="intent" value="delete-version" />
                    <input type="hidden" name="versionId" value={selectedVersion.id} />
                    <button
                      type="submit"
                      className="inline-flex items-center gap-1 px-3 py-1.5 text-sm font-medium rounded-md text-foreground/70 bg-card border border-border hover:bg-muted/50"
                    >
                      <Trash2 className="w-4 h-4" /> Delete
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
    </ManagedEditorShell>
  );
}

// One editable config pill: a compact "Label: value ▾" chip whose dropdown
// applies a new value via onSelect. Replaces the old read-only meta badges and
// the Settings box — editing happens inline on the top-level pills.
function ConfigPill({
  label,
  value,
  selected,
  options,
  onSelect,
}: {
  label: string;
  value: string;
  selected: string;
  options: { value: string; label: string }[];
  onSelect: (value: string) => void;
}) {
  return (
    <Menu
      align="left"
      ariaLabel={label}
      trigger={
        <button
          type="button"
          className="rounded bg-muted px-2 py-0.5 inline-flex items-center gap-1 transition-colors hover:bg-muted/70"
        >
          <span className="text-muted-foreground">{label}:</span>
          <span className="text-foreground">{value}</span>
          <ChevronDown className="w-3 h-3 opacity-60" />
        </button>
      }
    >
      {options.map((o) => (
        <Menu.Item key={o.value} onSelect={() => onSelect(o.value)}>
          {o.value === selected ? `✓ ${o.label}` : o.label}
        </Menu.Item>
      ))}
    </Menu>
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
  return (
    <div className="bg-card rounded-xl border border-border p-6 shadow-sm space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-foreground/80 uppercase tracking-wide">
          In force &amp; signatories
        </h3>
      </div>
      {document.bindings.map((b) => {
        const context =
          b.cycle?.name ? `cycle: ${b.cycle.name}` : b.term?.code ? `term: ${b.term.code}` : "app-wide";
        // Pre-signed staff counter-signatures, recorded automatically at issuance
        // from the admin-signature fields placed in the body.
        const counterSigners = b.signatures
          .filter((s) => s.roleKey === "supervisor")
          .map((s) => s.typedName || fullName(s.signer) || UNKNOWN_LABEL);
        const roster = rosters[b.id];
        return (
          <div key={b.id} className="rounded-lg border border-border p-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-medium text-foreground">
                {context} · v{b.version.versionNumber}
              </p>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              {counterSigners.length > 0
                ? `Counter-signed by ${counterSigners.join(", ")}`
                : "No admin signature configured"}
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
                        <Tooltip content="View signed copy">
                          <Link
                            to={`/core/agreements/${document.id}/signature/${s.signatureId}`}
                            className="block truncate text-xs text-accent-coral hover:underline"
                          >
                            {s.name}
                          </Link>
                        </Tooltip>
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
