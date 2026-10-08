// Admin → Email. One surface for every operator-editable email, replacing three:
// the versioned-library detail page, the hiring cycle Setup-tab modal, and the
// education manage-page modal.
//
// Grouped by registry area. Each row shows whether an email exists for that key
// and what happens when it doesn't, because "no row" is meaningful and differs
// per key (send nothing / refuse the release / fall back to built-in copy).

import { useEffect, useMemo, useState } from "react";
import { Form, useFetcher, useNavigation, useSearchParams } from "react-router";
import { AlertTriangle, Check, Mail, RotateCcw } from "lucide-react";

import { Modal, ModalHeader } from "~/components/Modal";
import { modalCardClass } from "~/components/os-chrome";
import { SearchInput } from "~/components/ui/SearchInput";
import {
  EMAIL_TEMPLATE_KEYS,
  emailTemplateDef,
  type EmailTemplateKey,
  type WhenMissing,
} from "~/email/lib/registry";
import { renderEmail } from "~/lib/email";
import { extractPlaceholders, TEMPLATE_VARIABLES_REGISTRY } from "~/lib/template-variables";

const TITLE_ID = "admin-email-editor-title";

export type AdminEmailRow = {
  key: EmailTemplateKey;
  // The EFFECTIVE copy: the operator's row when there is one, otherwise the
  // registry's own wording. The editor opens pre-filled with this so a change is
  // a change, not a retype.
  subject: string | null;
  body: string | null;
  // Whether a row exists. Drives the badge, not the textarea.
  edited: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
  versionCount: number;
};

export type AdminEmailVersion = {
  id: string;
  versionNumber: number;
  subject: string;
  body: string;
  createdAt: string;
  author: string;
};

// What an unedited template's status means, which differs per key: absence is
// the operator's answer for some and merely "untouched" for others.
function uneditedLabel(when: WhenMissing): string {
  switch (when) {
    case "skip":
      return "Nothing sends for this yet";
    case "error":
      return "Not written — releasing is blocked until it is";
    case "default":
      return "Using the built-in wording";
  }
}

// Soft lint, carried over from the hiring editor: a warning never blocks a save.
// `unknown` catches typos like {{firstname}}; `unfilled` catches a real variable
// this key's call site never populates, which would ship as literal text.
function lint(text: string, allowed: readonly string[]) {
  const known = new Set(Object.keys(TEMPLATE_VARIABLES_REGISTRY));
  const used = new Set(extractPlaceholders(text));
  return {
    unknown: [...used].filter((t) => !known.has(t)),
    unfilled: [...used].filter((t) => known.has(t) && !allowed.includes(t)),
  };
}

export function EmailTemplatesAdmin({
  rows,
  versions,
  openKey,
}: {
  rows: AdminEmailRow[];
  versions: AdminEmailVersion[];
  openKey: EmailTemplateKey | null;
}) {
  const [query, setQuery] = useState("");
  const byKey = useMemo(() => new Map(rows.map((r) => [r.key, r])), [rows]);

  const areas = useMemo(() => {
    const q = query.trim().toLowerCase();
    const out: { area: string; keys: EmailTemplateKey[] }[] = [];
    for (const key of EMAIL_TEMPLATE_KEYS) {
      const def = emailTemplateDef(key);
      if (
        q &&
        !def.label.toLowerCase().includes(q) &&
        !def.area.toLowerCase().includes(q) &&
        !(byKey.get(key)?.subject ?? "").toLowerCase().includes(q)
      ) {
        continue;
      }
      const bucket = out.find((b) => b.area === def.area);
      if (bucket) bucket.keys.push(key);
      else out.push({ area: def.area, keys: [key] });
    }
    return out;
  }, [query, byKey]);

  return (
    <div className="space-y-6">
      <div className="max-w-sm">
        <SearchInput
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search emails"
        />
      </div>

      {areas.length === 0 ? (
        <p className="text-sm text-muted-foreground">No emails match that search.</p>
      ) : null}

      {areas.map(({ area, keys }) => (
        <section key={area} className="space-y-2">
          <h2 className="text-sm font-semibold">{area}</h2>
          <div className="border rounded-lg divide-y">
            {keys.map((key) => (
              <EmailRow key={key} templateKey={key} row={byKey.get(key) ?? null} />
            ))}
          </div>
        </section>
      ))}

      {openKey ? (
        <EmailEditor
          templateKey={openKey}
          row={byKey.get(openKey) ?? null}
          versions={versions}
        />
      ) : null}
    </div>
  );
}

function EmailRow({
  templateKey,
  row,
}: {
  templateKey: EmailTemplateKey;
  row: AdminEmailRow | null;
}) {
  const def = emailTemplateDef(templateKey);
  const edited = !!row?.edited;
  // An unedited key that falls back to registry wording still sends, so it is not
  // a warning — only a key whose absence means nothing sends (or blocks a
  // release) deserves one.
  const warn = !edited && def.whenMissing !== "default";
  return (
    <div className="flex items-start gap-3 p-3">
      <Mail className="w-4 h-4 mt-0.5 text-muted-foreground shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{def.label}</span>
          {edited ? (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <Check className="w-3 h-3" /> Edited
            </span>
          ) : (
            <span
              className={`inline-flex items-center gap-1 text-xs ${
                warn ? "text-amber-600 dark:text-amber-500" : "text-muted-foreground"
              }`}
            >
              {warn ? <AlertTriangle className="w-3 h-3" /> : null}
              {uneditedLabel(def.whenMissing)}
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">{def.description}</p>
        {row?.subject ? (
          <p className="text-xs text-muted-foreground mt-1 truncate">
            Subject: {row.subject}
          </p>
        ) : null}
        <p className="text-[11px] text-muted-foreground mt-1">
          Sends as {def.purpose}
          {row?.updatedAt
            ? ` · edited ${new Date(row.updatedAt).toLocaleDateString()}${row.updatedBy ? ` by ${row.updatedBy}` : ""}`
            : ""}
          {row && row.versionCount > 0 ? ` · ${row.versionCount} version${row.versionCount === 1 ? "" : "s"}` : ""}
        </p>
      </div>
      <Form method="get" className="shrink-0">
        <input type="hidden" name="key" value={templateKey} />
        <button type="submit" className="text-sm underline">
          {row?.subject || row?.body ? "Edit" : "Write"}
        </button>
      </Form>
    </div>
  );
}

const EDITOR_ROUTE = "/core/communications/email";

// The same editor, opened over whatever page the email is used on (a hiring
// cycle's Setup tab) so editing it doesn't mean leaving that page. It reads and
// writes through the Core email route, so that route's Core-only check and its
// one save path still govern.
export function EmailEditorModal({
  templateKey,
  onClose,
}: {
  templateKey: EmailTemplateKey;
  onClose: () => void;
}) {
  const loader = useFetcher<{ rows: AdminEmailRow[]; versions: AdminEmailVersion[] }>();
  useEffect(() => {
    loader.load(`${EDITOR_ROUTE}?key=${encodeURIComponent(templateKey)}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateKey]);
  if (!loader.data) return null;
  const row = loader.data.rows.find((r) => r.key === templateKey) ?? null;
  return (
    <EmailEditor
      // Reseeds the fields when a restore swaps the copy underneath them.
      key={row?.updatedAt ?? "unedited"}
      templateKey={templateKey}
      row={row}
      versions={loader.data.versions}
      onClose={onClose}
    />
  );
}

function EmailEditor({
  templateKey,
  row,
  versions,
  onClose,
}: {
  templateKey: EmailTemplateKey;
  row: AdminEmailRow | null;
  versions: AdminEmailVersion[];
  /** Set when opened in place on another page: saves stay on that page. */
  onClose?: () => void;
}) {
  const [, setSearchParams] = useSearchParams();
  const def = emailTemplateDef(templateKey);
  const nav = useNavigation();
  const fetcher = useFetcher<{ saved?: true }>();
  const inPlace = !!onClose;
  const EditorForm = inPlace ? fetcher.Form : Form;
  const formProps = inPlace ? { action: EDITOR_ROUTE } : {};
  const busy = inPlace ? fetcher.state !== "idle" : nav.state !== "idle";
  const saved = fetcher.state === "idle" && !!fetcher.data?.saved;
  useEffect(() => {
    if (saved) onClose?.();
  }, [saved]);
  // On the list, closing just drops ?key= — the list is the same route.
  const close =
    onClose ??
    (() =>
      setSearchParams((p) => {
        p.delete("key");
        return p;
      }));
  const [subject, setSubject] = useState(row?.subject ?? "");
  const [body, setBody] = useState(row?.body ?? "");

  const warnings = useMemo(
    () => lint(`${subject}\n${body}`, def.variables),
    [subject, body, def.variables],
  );
  const preview = useMemo(
    () => renderEmail({ subject, body }, def.sample as never),
    [subject, body, def.sample],
  );

  return (
    <Modal
      open
      onClose={close}
      labelledBy={TITLE_ID}
      containerClassName={modalCardClass("max-w-2xl")}
    >
      <ModalHeader
        titleId={TITLE_ID}
        title={def.label}
        subtitle={def.description}
        onClose={close}
      />
      <div className="space-y-4">

        <EditorForm method="post" {...formProps} className="space-y-4">
          <input type="hidden" name="intent" value="save" />
          <input type="hidden" name="key" value={templateKey} />
          {inPlace && <input type="hidden" name="stay" value="1" />}

          <label className="block">
            <span className="text-sm font-medium">Subject</span>
            <input
              name="subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="mt-1 w-full border rounded px-2 py-1.5 text-sm bg-transparent"
            />
          </label>

          <label className="block">
            <span className="text-sm font-medium">Body</span>
            <textarea
              name="body"
              rows={14}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              className="mt-1 w-full border rounded px-2 py-1.5 text-sm font-mono bg-transparent"
            />
          </label>

          <p className="text-xs text-muted-foreground">
            Supports{" "}
            {def.variables.map((v, i) => (
              <span key={v}>
                {i > 0 ? ", " : ""}
                <code>{`{{${v}}}`}</code>
              </span>
            ))}
            . Leave both fields empty to turn this email off.
          </p>

          {warnings.unknown.length > 0 ? (
            <p className="text-xs text-amber-600 dark:text-amber-500">
              Not a known variable: {warnings.unknown.map((t) => `{{${t}}}`).join(", ")}. These
              ship as literal text — placeholders are case-sensitive.
            </p>
          ) : null}
          {warnings.unfilled.length > 0 ? (
            <p className="text-xs text-amber-600 dark:text-amber-500">
              Never filled for this email: {warnings.unfilled.map((t) => `{{${t}}}`).join(", ")}.
            </p>
          ) : null}

          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={busy}
              className="px-3 py-1.5 text-sm rounded bg-foreground text-background disabled:opacity-50"
            >
              Save changes
            </button>
            <button
              type="submit"
              name="intent"
              value="send-test"
              disabled={busy || (!subject.trim() && !body.trim())}
              className="px-3 py-1.5 text-sm rounded border disabled:opacity-50"
            >
              Send test to me
            </button>
          </div>
        </EditorForm>

        <div>
          <h3 className="text-sm font-medium mb-1">Preview</h3>
          <p className="text-xs text-muted-foreground mb-2">
            Rendered with sample values, through the same path as a real send.
          </p>
          <div className="border rounded p-3 text-sm">
            <p className="font-medium mb-2">{preview.subject}</p>
            {/* Safe: renderEmail runs the body through DOMPurify. */}
            <div dangerouslySetInnerHTML={{ __html: preview.html }} />
          </div>
        </div>

        {versions.length > 0 ? (
          <div>
            <h3 className="text-sm font-medium mb-1">History</h3>
            <div className="border rounded divide-y">
              {versions.map((v) => (
                <div key={v.id} className="flex items-center gap-3 p-2 text-xs">
                  <span className="font-medium shrink-0">v{v.versionNumber}</span>
                  <span className="min-w-0 flex-1 truncate">{v.subject}</span>
                  <span className="text-muted-foreground shrink-0">
                    {new Date(v.createdAt).toLocaleDateString()} · {v.author}
                  </span>
                  <EditorForm method="post" {...formProps} className="shrink-0">
                    <input type="hidden" name="intent" value="rollback" />
                    <input type="hidden" name="key" value={templateKey} />
                    <input type="hidden" name="versionId" value={v.id} />
                    {inPlace && <input type="hidden" name="stay" value="1" />}
                    <button
                      type="submit"
                      className="inline-flex items-center gap-1 underline"
                      title="Restore this version as a new one"
                    >
                      <RotateCcw className="w-3 h-3" /> Restore
                    </button>
                  </EditorForm>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
