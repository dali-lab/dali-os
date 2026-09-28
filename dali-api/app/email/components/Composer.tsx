import { useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";
import { Check, Languages, Paperclip, PenLine, Send, Sparkles, SpellCheck, Trash2, Undo2, Wand2, X } from "lucide-react";
import { Button } from "~/components/ui/Button";
import { IconButton } from "~/components/ui/IconButton";
import { Toggle } from "~/components/ui/Toggle";
import { Menu, MenuItem, Select } from "~/components/ui/floating";
import { useDialog } from "~/components/ui/dialog";
import { useToast } from "~/components/ui/toast";
import { AddressInput, type KnownAddress } from "~/email/components/AddressInput";
import type { EmailPageData } from "~/email/lib/email.server";
import { wordDiff } from "~/email/lib/word-diff";
import { cn } from "~/lib/cn";
import { formatBytes, uploadFileToS3 } from "~/lib/upload-client";

type Draft = EmailPageData["drafts"][number];
type Attachment = Draft["attachments"][number];
type Account = EmailPageData["accounts"][number];
type ActionResult = { ok?: boolean; sent?: boolean; draftId?: string; error?: string };
type AttachResult = { ok?: boolean; draftId?: string; attachments?: Attachment[]; error?: string };
type AiTask = "draft" | "rephrase" | "proofread" | "translate";
export type RecipientDirectory = { people: KnownAddress[]; domains: string[] };

// The quiet proofread offered while writing. It waits for a pause, skips short
// drafts, and spaces calls out so pausing often doesn't burn through the burst
// limit on /api/ai/email.
const SUGGEST_IDLE_MS = 2500;
const SUGGEST_MIN_CHARS = 40;
const SUGGEST_MIN_GAP_MS = 15_000;

const sameText = (a: string, b: string) => a.replace(/\s+/g, " ").trim() === b.replace(/\s+/g, " ").trim();

const fieldClass =
  "w-full rounded-[10px] border border-os-container bg-os-well px-3 py-2 text-sm text-foreground placeholder:text-os-muted outline-none hover:border-os-container-hi focus:border-os-accent";

export function Composer({
  accounts,
  accountId: initialAccountId,
  threadId,
  draft,
  replyTo,
  aiEnabled,
  directory,
  onDone,
}: {
  accounts: Account[];
  accountId: string;
  threadId: string | null;
  draft?: Draft;
  replyTo?: string;
  aiEnabled: boolean;
  directory: RecipientDirectory;
  onDone: () => void;
}) {
  const fetcher = useFetcher<ActionResult>();
  const dialog = useDialog();
  const toast = useToast();
  const [accountId, setAccountId] = useState(draft?.accountId ?? initialAccountId);
  const [to, setTo] = useState(draft?.to ?? replyTo ?? "");
  const [cc, setCc] = useState(draft?.cc ?? "");
  const [bcc, setBcc] = useState(draft?.bcc ?? "");
  const [showBcc, setShowBcc] = useState(Boolean(draft?.bcc));
  const [subject, setSubject] = useState(draft?.subject ?? "");
  const [body, setBody] = useState(draft?.body ?? "");
  const [shared, setShared] = useState(draft?.shared ?? false);
  const [draftId, setDraftId] = useState(draft?.id ?? "");
  const [attachments, setAttachments] = useState<Attachment[]>(draft?.attachments ?? []);
  const [uploading, setUploading] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [undoBody, setUndoBody] = useState<string | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [suggestion, setSuggestion] = useState<{ source: string; text: string } | null>(null);
  // The last text a suggestion was requested for (or that AI itself wrote), so
  // a pause without new typing never asks again. Starts at the loaded draft.
  const suggestedFor = useRef(body);
  const lastSuggestAt = useRef(0);
  const suggestOff = useRef(false);
  const handled = useRef<ActionResult | undefined>(undefined);

  const account = accounts.find((a) => a.id === accountId);
  const connected = accounts.filter((a) => a.connected);
  const busy = fetcher.state !== "idle";

  useEffect(() => {
    const data = fetcher.data;
    if (fetcher.state !== "idle" || !data || handled.current === data) return;
    handled.current = data;
    if (data.draftId) setDraftId(data.draftId);
    if (data.error) toast.error(data.error);
    else if (data.sent) {
      toast.success("Sent");
      onDone();
    } else toast.success("Draft saved");
  }, [fetcher.state, fetcher.data, toast, onDone]);

  const submit = (intent: "saveDraft" | "send") => {
    fetcher.submit(
      {
        intent,
        draftId,
        accountId,
        threadId: threadId ?? "",
        to,
        cc,
        bcc: showBcc ? bcc : "",
        subject,
        body,
        shared: shared ? "on" : "",
      },
      { method: "post" },
    );
  };

  // Attach/detach go straight to the route action (not the shared fetcher) so
  // they don't fire the save/send toasts, and so uploads run one at a time —
  // the first pins the draft, later files reuse the id it returns.
  const postForm = async (fields: Record<string, string>): Promise<AttachResult> => {
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) form.append(k, v);
    const res = await fetch("/email", { method: "POST", body: form, credentials: "include" });
    return (await res.json()) as AttachResult;
  };

  const draftFields = () => ({
    accountId,
    threadId: threadId ?? "",
    to,
    cc,
    bcc: showBcc ? bcc : "",
    subject,
    body,
    shared: shared ? "on" : "",
  });

  const addFiles = async (files: File[]) => {
    let id = draftId;
    for (const file of files) {
      setUploading((n) => n + 1);
      try {
        const meta = await uploadFileToS3(file, "email-attachments");
        const res = await postForm({
          intent: "attach",
          draftId: id,
          ...draftFields(),
          s3Key: meta.s3Key,
          filename: meta.fileName,
          contentType: meta.contentType,
          sizeBytes: String(meta.sizeBytes),
        });
        if (res.error) toast.error(res.error);
        else {
          if (res.draftId) {
            id = res.draftId;
            setDraftId(res.draftId);
          }
          if (res.attachments) setAttachments(res.attachments);
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Couldn't attach that file.");
      } finally {
        setUploading((n) => n - 1);
      }
    }
  };

  const removeAttachment = async (attachmentId: string) => {
    const prev = attachments;
    setAttachments((a) => a.filter((x) => x.id !== attachmentId));
    const res = await postForm({ intent: "detach", draftId, accountId, attachmentId });
    if (res.error) {
      toast.error(res.error);
      setAttachments(prev);
    } else if (res.attachments) setAttachments(res.attachments);
  };

  const discard = async () => {
    if (draftId) {
      const ok = await dialog.confirm({
        title: "Discard this draft?",
        description: draft?.shared ? "It's shared, so it disappears for your teammates too." : undefined,
        confirmLabel: "Discard",
        tone: "destructive",
      });
      if (!ok) return;
      fetcher.submit({ intent: "deleteDraft", draftId, accountId }, { method: "post" });
    }
    onDone();
  };

  const runAi = async (task: AiTask) => {
    let instruction = "";
    let language = "";
    if (task === "draft" || task === "rephrase") {
      const value = await dialog.prompt({
        title: task === "draft" ? "Write with AI" : "Rephrase",
        label: task === "draft" ? "What should it say?" : "How should it change? (optional)",
        placeholder: task === "draft" ? "Thank them and propose Tuesday at 3" : "Shorter and warmer",
        confirmLabel: task === "draft" ? "Write" : "Rephrase",
      });
      if (value === null) return;
      instruction = value;
    }
    if (task === "translate") {
      const value = await dialog.prompt({
        title: "Translate",
        label: "Into which language?",
        placeholder: "Spanish",
        confirmLabel: "Translate",
        validate: (v) => (v.trim() ? null : "Enter a language"),
      });
      if (value === null) return;
      language = value;
    }
    setAiBusy(true);
    try {
      const res = await fetch("/api/ai/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task, text: body, instruction, language, accountId, threadId }),
      });
      const data = (await res.json()) as { text?: string; error?: string };
      if (!res.ok || !data.text) {
        toast.error(data.error ?? "AI couldn't help with that one.");
        return;
      }
      setUndoBody(body);
      setBody(data.text);
      suggestedFor.current = data.text;
      setSuggestion(null);
    } catch {
      toast.error("AI couldn't help with that one.");
    } finally {
      setAiBusy(false);
    }
  };

  useEffect(() => {
    if (!aiEnabled || aiBusy || suggestOff.current) return;
    const source = body;
    if (source.trim().length < SUGGEST_MIN_CHARS || source === suggestedFor.current) return;
    const controller = new AbortController();
    const wait = Math.max(SUGGEST_IDLE_MS, lastSuggestAt.current + SUGGEST_MIN_GAP_MS - Date.now());
    const timer = setTimeout(async () => {
      suggestedFor.current = source;
      lastSuggestAt.current = Date.now();
      try {
        const res = await fetch("/api/ai/email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ task: "proofread", text: source }),
          signal: controller.signal,
        });
        // Out of quota or AI unavailable: stop quietly for this draft rather
        // than toast about something the user never asked for.
        if (res.status === 429 || res.status === 503 || res.status === 403) {
          suggestOff.current = true;
          return;
        }
        const data = (await res.json()) as { text?: string };
        if (res.ok && data.text && !sameText(data.text, source)) setSuggestion({ source, text: data.text.trim() });
      } catch {
        // Aborted by more typing, or a network blip — the next pause retries.
        if (!controller.signal.aborted) suggestedFor.current = "";
      }
    }, wait);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [body, aiEnabled, aiBusy]);

  const liveSuggestion = suggestion && suggestion.source === body ? suggestion : null;
  const suggestionDiff = liveSuggestion ? wordDiff(liveSuggestion.source, liveSuggestion.text) : null;

  const acceptSuggestion = () => {
    if (!liveSuggestion) return;
    setUndoBody(body);
    setBody(liveSuggestion.text);
    suggestedFor.current = liveSuggestion.text;
    setSuggestion(null);
  };

  return (
    <div className="flex flex-col gap-2 rounded-os-card bg-os-card p-3">
      {!threadId && !draftId && connected.length > 1 && (
        <Select
          ariaLabel="From"
          value={accountId}
          onChange={setAccountId}
          options={connected.map((a) => ({ value: a.id, label: `From ${a.address}` }))}
        />
      )}
      <div className="relative">
        <AddressInput
          ariaLabel="To"
          placeholder="To"
          value={to}
          onChange={setTo}
          known={directory.people}
          domains={directory.domains}
          className={cn(fieldClass, !showBcc && "pr-14")}
        />
        {!showBcc && (
          <button
            type="button"
            onClick={() => setShowBcc(true)}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md px-1.5 py-0.5 text-xs text-os-muted hover:bg-os-hover hover:text-foreground"
          >
            Bcc
          </button>
        )}
      </div>
      <AddressInput
        ariaLabel="Cc"
        placeholder="Cc"
        value={cc}
        onChange={setCc}
        known={directory.people}
        domains={directory.domains}
        className={fieldClass}
      />
      {showBcc && (
        <AddressInput
          ariaLabel="Bcc"
          placeholder="Bcc"
          value={bcc}
          onChange={setBcc}
          known={directory.people}
          domains={directory.domains}
          className={fieldClass}
        />
      )}
      {!threadId && (
        <input
          aria-label="Subject"
          placeholder="Subject"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          className={fieldClass}
        />
      )}
      <textarea
        aria-label="Message"
        placeholder={threadId ? "Write a reply" : "Write a message"}
        value={body}
        onChange={(e) => {
          setBody(e.target.value);
          setUndoBody(null);
        }}
        rows={8}
        className={`${fieldClass} resize-y leading-relaxed`}
        disabled={aiBusy}
      />
      {liveSuggestion && (
        <div
          role="status"
          className="flex flex-col gap-2 rounded-[10px] border border-os-accent/40 bg-os-well p-3 motion-safe:animate-area-menu"
        >
          <span className="flex items-center gap-1.5 text-xs font-semibold text-os-accent">
            <SpellCheck className="h-3.5 w-3.5" />
            Suggested edit
          </span>
          <p className="max-h-48 overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed text-foreground">
            {suggestionDiff
              ? suggestionDiff.map((part, i) =>
                  part.kind === "same" ? (
                    <span key={i}>{part.text}</span>
                  ) : part.kind === "added" ? (
                    <ins key={i} className="rounded-sm bg-os-green/20 text-os-green no-underline">
                      {part.text}
                    </ins>
                  ) : (
                    <del key={i} className="text-os-muted line-through">
                      {part.text}
                    </del>
                  ),
                )
              : liveSuggestion.text}
          </p>
          <div className="flex items-center gap-2">
            <Button size="xs" onClick={acceptSuggestion}>
              <Check className="h-3.5 w-3.5" />
              Use edit
            </Button>
            <Button variant="ghost" size="xs" onClick={() => setSuggestion(null)}>
              <X className="h-3.5 w-3.5" />
              Dismiss
            </Button>
          </div>
        </div>
      )}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          void addFiles(Array.from(e.target.files ?? []));
          e.target.value = "";
        }}
      />
      {(attachments.length > 0 || uploading > 0) && (
        <div className="flex flex-wrap gap-1.5">
          {attachments.map((att) => (
            <span
              key={att.id}
              className="inline-flex max-w-full items-center gap-1 rounded-full bg-os-container px-2.5 py-1 text-xs text-foreground"
            >
              <Paperclip className="h-3 w-3 shrink-0" />
              <span className="truncate">{att.filename}</span>
              <span className="shrink-0 text-os-muted">{formatBytes(att.sizeBytes)}</span>
              <button
                type="button"
                aria-label={`Remove ${att.filename}`}
                onClick={() => removeAttachment(att.id)}
                className="shrink-0 rounded-full p-0.5 text-os-muted hover:bg-os-hover hover:text-foreground"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
          {uploading > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-os-container px-2.5 py-1 text-xs text-os-muted">
              <Paperclip className="h-3 w-3 animate-pulse" />
              Uploading…
            </span>
          )}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <IconButton
          label="Attach files"
          icon={Paperclip}
          onClick={() => fileInputRef.current?.click()}
          disabled={aiBusy}
        />
        {aiEnabled && (
          <button
            type="button"
            disabled={aiBusy}
            onClick={() => runAi("draft")}
            className="inline-flex items-center gap-1.5 rounded-full bg-os-container px-3 py-1.5 text-xs font-medium text-foreground hover:bg-os-container-hi disabled:opacity-50"
          >
            <PenLine className="h-3.5 w-3.5" />
            {aiBusy ? "Writing…" : "Write with AI"}
          </button>
        )}
        {aiEnabled && (
          <Menu
            ariaLabel="AI tools"
            trigger={
              <button
                type="button"
                disabled={aiBusy}
                className="inline-flex items-center gap-1.5 rounded-full bg-os-container px-3 py-1.5 text-xs font-medium text-foreground hover:bg-os-container-hi disabled:opacity-50"
              >
                <Sparkles className="h-3.5 w-3.5" />
                AI tools
              </button>
            }
          >
            <MenuItem icon={<Wand2 className="h-4 w-4" />} disabled={!body.trim()} onSelect={() => runAi("rephrase")}>
              Rephrase
            </MenuItem>
            <MenuItem icon={<SpellCheck className="h-4 w-4" />} disabled={!body.trim()} onSelect={() => runAi("proofread")}>
              Proofread
            </MenuItem>
            <MenuItem icon={<Languages className="h-4 w-4" />} disabled={!body.trim()} onSelect={() => runAi("translate")}>
              Translate
            </MenuItem>
          </Menu>
        )}
        {undoBody !== null && (
          <IconButton
            label="Undo AI change"
            icon={Undo2}
            onClick={() => {
              suggestedFor.current = undoBody;
              setBody(undoBody);
              setUndoBody(null);
            }}
          />
        )}
        {account && (
          <Toggle
            label="Share draft with team"
            checked={shared}
            onChange={(e) => setShared(e.target.checked)}
          />
        )}
        <div className="ml-auto flex items-center gap-2">
          <IconButton label="Discard draft" icon={Trash2} tone="destructive" onClick={discard} disabled={busy} />
          <Button variant="secondary" size="sm" onClick={() => submit("saveDraft")} disabled={busy}>
            Save draft
          </Button>
          <Button size="sm" onClick={() => submit("send")} disabled={busy || aiBusy || uploading > 0 || !to.trim()}>
            <Send className="h-3.5 w-3.5" />
            Send
          </Button>
        </div>
      </div>
      {draft && !draft.mine && (
        <p className="text-xs text-os-muted">Shared draft started by {draft.author}</p>
      )}
    </div>
  );
}
