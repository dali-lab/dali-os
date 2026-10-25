// Core → Communications → Email templates. One surface for every
// operator-editable email: the templates grouped by registry area on the left,
// the open one's editor, preview and history on the right.

import { useEffect, useMemo, useRef, useState } from "react";
import { Form, useFetcher, useNavigation, useSearchParams } from "react-router";
import { AlertTriangle, History, RotateCcw, Send } from "lucide-react";

import { Modal, ModalHeader } from "~/components/Modal";
import { modalCardClass, useOsChrome } from "~/components/os-chrome";
import { SearchInput } from "~/components/ui/SearchInput";
import { useToast } from "~/components/ui/toast";
import { Pill } from "~/hiring/components/cycle-setup/SetupCard";
import { cn } from "~/lib/cn";
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
      return "Not written yet. Releasing is blocked until it is";
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
  openKey: EmailTemplateKey;
}) {
  const [query, setQuery] = useState("");
  const [, setSearchParams] = useSearchParams();
  const byKey = useMemo(() => new Map(rows.map((r) => [r.key, r])), [rows]);
  const areas = useMemo(() => groupByArea(query, byKey), [query, byKey]);
  const row = byKey.get(openKey) ?? null;

  return (
    <div className="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
      <nav
        aria-label="Email templates"
        className="flex max-h-[60vh] flex-col gap-3 lg:sticky lg:top-6 lg:max-h-[calc(100dvh-8rem)] lg:self-start"
      >
        <SearchInput value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search emails" />
        <div className="-mr-2 flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto pr-2">
        {areas.length === 0 && <p className="px-3 text-sm text-os-muted">No emails match that search.</p>}
        {areas.map(({ area, keys }) => (
          <div key={area} className="flex flex-col gap-1">
            <p className="px-3 text-xs font-semibold text-os-muted">{area}</p>
            {keys.map((key) => {
              const active = key === openKey;
              const r = byKey.get(key);
              return (
                <button
                  key={key}
                  type="button"
                  aria-current={active ? "true" : undefined}
                  onClick={() => setSearchParams({ key }, { replace: true, preventScrollReset: true })}
                  className={cn(
                    "flex items-center justify-between gap-2 rounded-os-item px-3 py-2 text-left text-sm transition-colors",
                    active ? "bg-os-container text-foreground" : "text-os-grey hover:bg-os-hover hover:text-foreground",
                  )}
                >
                  <span className="min-w-0 truncate">{emailTemplateDef(key).label}</span>
                  {r?.edited ? (
                    <span className="shrink-0 text-[11px] text-os-muted">Edited</span>
                  ) : emailTemplateDef(key).whenMissing !== "default" ? (
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-os-amber" aria-label="Not written yet" />
                  ) : null}
                </button>
              );
            })}
          </div>
        ))}
        </div>
      </nav>

      <TemplatePanel
        // Reseeds the fields when another template opens or a restore swaps the copy.
        key={`${openKey}:${row?.updatedAt ?? "unedited"}`}
        templateKey={openKey}
        row={row}
        versions={versions}
      />
    </div>
  );
}

function groupByArea(query: string, byKey: Map<EmailTemplateKey, AdminEmailRow>) {
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
}

function TemplatePanel({
  templateKey,
  row,
  versions,
}: {
  templateKey: EmailTemplateKey;
  row: AdminEmailRow | null;
  versions: AdminEmailVersion[];
}) {
  const os = useOsChrome();
  const toast = useToast();
  const def = emailTemplateDef(templateKey);
  const fetcher = useFetcher<{ saved?: true; rolledBack?: true; testSent?: true; error?: string }>();
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const [subject, setSubject] = useState(row?.subject ?? "");
  const [body, setBody] = useState(row?.body ?? "");
  const dirty = subject !== (row?.subject ?? "") || body !== (row?.body ?? "");
  const busy = fetcher.state !== "idle";

  const warnings = useMemo(() => lint(`${subject}\n${body}`, def.variables), [subject, body, def.variables]);
  const preview = useMemo(() => renderEmail({ subject, body }, def.sample as never), [subject, body, def.sample]);

  const handled = useRef<unknown>(null);
  useEffect(() => {
    const d = fetcher.data;
    if (fetcher.state !== "idle" || !d || handled.current === d) return;
    handled.current = d;
    if (d.error) toast.error(d.error);
    else if (d.testSent) toast.success("Test sent to your DALI email");
    else if (d.saved) toast.success("Saved. Every send uses it from now on");
    else if (d.rolledBack) toast.success("Version restored");
  }, [fetcher.state, fetcher.data, toast]);

  const submit = (intent: "save" | "send-test") =>
    fetcher.submit({ intent, key: templateKey, subject, body, stay: "1" }, { method: "post", action: EDITOR_ROUTE });

  const insert = (v: string) => {
    const token = `{{${v}}}`;
    const el = bodyRef.current;
    if (!el) return setBody((b) => b + token);
    const { selectionStart: a, selectionEnd: z } = el;
    setBody((b) => b.slice(0, a) + token + b.slice(z));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(a + token.length, a + token.length);
    });
  };

  const unwritten = !row?.edited && def.whenMissing !== "default";

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <section className={cn(os.panel, os.panelPad, os.formClass, "flex flex-col gap-5")} aria-label={`${def.label} template`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className={os.sectionTitle}>{def.label}</h2>
              <Pill>{def.area}</Pill>
            </div>
            <p className="mt-1 text-sm text-os-grey">{def.description}</p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              className={os.actionBtn()}
              disabled={busy || (!subject.trim() && !body.trim())}
              onClick={() => submit("send-test")}
            >
              <Send className={os.actionIcon} /> Send test
            </button>
            <button type="button" className={os.actionBtnPrimary} disabled={busy || !dirty} onClick={() => submit("save")}>
              Save
            </button>
          </div>
        </div>

        {(unwritten || !row?.edited) && (
          <p className={cn("flex items-center gap-2 text-sm", unwritten ? "text-os-amber" : "text-os-muted")}>
            {unwritten && <AlertTriangle className="h-4 w-4 shrink-0" />}
            {uneditedLabel(def.whenMissing)}
          </p>
        )}

        <label className={os.fieldLabel}>
          Subject
          <input value={subject} onChange={(e) => setSubject(e.target.value)} />
        </label>
        <label className={os.fieldLabel}>
          Body
          <textarea
            ref={bodyRef}
            rows={12}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            className="resize-y font-mono text-[13px] leading-relaxed"
          />
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-os-muted">Insert</span>
          {def.variables.map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => insert(v)}
              className="rounded-full bg-os-well px-2.5 py-1 font-mono text-xs text-os-accent transition-colors hover:bg-os-container"
            >
              {`{{${v}}}`}
            </button>
          ))}
        </div>
        <p className="text-xs text-os-muted">Leave both fields empty to turn this email off. Sends as {def.purpose}.</p>
        {warnings.unknown.length > 0 && (
          <p className="text-xs text-os-amber">
            Not a known variable: {warnings.unknown.map((t) => `{{${t}}}`).join(", ")}. These go out as plain text, and
            names are case-sensitive.
          </p>
        )}
        {warnings.unfilled.length > 0 && (
          <p className="text-xs text-os-amber">
            Never filled for this email: {warnings.unfilled.map((t) => `{{${t}}}`).join(", ")}.
          </p>
        )}
      </section>

      <section className="flex flex-col gap-3" aria-label="Preview">
        <h2 className="text-sm font-semibold text-os-grey">Preview with sample values</h2>
        <div className={cn(os.panel, os.panelPad, "text-sm")}>
          <p className="mb-3 font-semibold text-foreground">{preview.subject}</p>
          {/* Safe: renderEmail runs the body through DOMPurify. */}
          <div className="text-os-grey" dangerouslySetInnerHTML={{ __html: preview.html }} />
        </div>
      </section>

      <section className="flex flex-col gap-3" aria-label="Version history">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-os-grey">
          <History className="h-4 w-4" /> Version history
        </h2>
        <ol className={os.panel}>
          {versions.map((v, i) => (
            <li key={v.id} className={cn("flex items-center gap-4 px-6 py-3", i > 0 && "border-t border-os-container/70")}>
              <span className="w-8 text-sm tabular-nums text-os-muted">v{v.versionNumber}</span>
              <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                {v.author} <span className="text-os-muted">· {new Date(v.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>
              </span>
              {i === 0 ? (
                <span className="text-xs text-os-muted">Current</span>
              ) : (
                <fetcher.Form method="post" action={EDITOR_ROUTE}>
                  <input type="hidden" name="intent" value="rollback" />
                  <input type="hidden" name="key" value={templateKey} />
                  <input type="hidden" name="versionId" value={v.id} />
                  <input type="hidden" name="stay" value="1" />
                  <button type="submit" className={os.actionBtn()} disabled={busy}>
                    Restore
                  </button>
                </fetcher.Form>
              )}
            </li>
          ))}
          {versions.length === 0 && (
            <li className="px-6 py-10 text-center text-sm text-os-muted">No saved versions yet.</li>
          )}
        </ol>
      </section>
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
            <p className="text-xs text-os-amber">
              Not a known variable: {warnings.unknown.map((t) => `{{${t}}}`).join(", ")}. These
              ship as literal text — placeholders are case-sensitive.
            </p>
          ) : null}
          {warnings.unfilled.length > 0 ? (
            <p className="text-xs text-os-amber">
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
