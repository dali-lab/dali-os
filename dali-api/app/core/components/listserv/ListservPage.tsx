import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useFetcher } from "react-router";
import { Check, Copy, MessageSquareWarning, Pencil, Plus, Settings2, Trash2, Undo2 } from "lucide-react";
import { SegmentedTabButtons } from "~/components/AreaPillNav";
import { Drawer } from "~/components/ui/Drawer";
import { Modal, ModalHeader } from "~/components/Modal";
import { Checkbox } from "~/components/ui/Checkbox";
import { DateField } from "~/components/ui/DateField";
import { IconButton } from "~/components/ui/IconButton";
import { Combobox } from "~/components/ui/floating";
import { useDialog } from "~/components/ui/dialog";
import { useToast } from "~/components/ui/toast";
import { modalCardClass, useOsChrome } from "~/components/os-chrome";
import { Pill } from "~/hiring/components/cycle-setup/SetupCard";
import { cn } from "~/lib/cn";
import {
  STATUS_DOT,
  URGENCY_TEXT,
  bySendBy,
  daysAgo,
  formatDay,
  hasContent,
  sendByLabel,
  statusLabel,
  toPlainText,
  urgency,
  type ListservDraft,
  type ListservStatus,
} from "~/core/lib/listserv";
import type { ListservRow } from "~/core/lib/listserv.server";
import { AttachmentsField, EmailBody, EmailBodyEditor, SubmissionList, newBlockId } from "./parts";

export type ListservData = {
  viewerId: string;
  isAdmin: boolean;
  isLead: boolean;
  lead: { id: string; name: string } | null;
  fromAddress: string;
  candidates: { id: string; name: string }[];
  submissions: ListservRow[];
  today: string;
};

type ActionData = { ok: true; done: string; count?: number; sentOn?: string } | { ok: false; error: string };
type View = "queue" | "sent";

/** Runs one listserv action and toasts its outcome once. */
function useListservAction(onDone?: (d: Extract<ActionData, { ok: true }>) => void) {
  const fetcher = useFetcher<ActionData>();
  const toast = useToast();
  const handled = useRef<ActionData | null>(null);
  useEffect(() => {
    const d = fetcher.data;
    if (fetcher.state !== "idle" || !d || handled.current === d) return;
    handled.current = d;
    if (!d.ok) toast.error(d.error);
    else onDone?.(d);
  }, [fetcher.state, fetcher.data, toast, onDone]);
  const run = (fields: Record<string, string | string[]>) => {
    const body = new FormData();
    for (const [k, v] of Object.entries(fields)) {
      for (const one of Array.isArray(v) ? v : [v]) body.append(k, one);
    }
    fetcher.submit(body, { method: "post" });
  };
  return { run, busy: fetcher.state !== "idle" };
}

export function ListservPage({ data }: { data: ListservData }) {
  const os = useOsChrome();
  const toast = useToast();
  const { isLead, viewerId, today } = data;
  const leadName = data.lead?.name ?? "The outreach lead";
  const [view, setView] = useState<View>("queue");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [composer, setComposer] = useState<{ open: boolean; editing: ListservRow | null }>({ open: false, editing: null });
  const [markOpen, setMarkOpen] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);

  const queue = useMemo(() => data.submissions.filter((s) => s.status !== "Sent"), [data.submissions]);
  const sent = useMemo(() => data.submissions.filter((s) => s.status === "Sent" && s.sentOn), [data.submissions]);
  const ready = useMemo(() => queue.filter((s) => s.status === "Approved").sort(bySendBy), [queue]);
  const overdue = queue.filter((s) => s.sendBy && urgency(s.sendBy, today) === "overdue");
  const mine = queue.filter((s) => s.submitter.id === viewerId);
  const lastSentOn = sent.map((s) => s.sentOn!).sort().pop();
  const selected = data.submissions.find((s) => s.id === selectedId) ?? null;

  const groups: { status: ListservStatus; title: string; empty: string }[] = isLead
    ? [
        { status: "Submitted", title: "Needs review", empty: "Nothing waiting for review." },
        { status: "ChangesRequested", title: "Waiting on the submitter", empty: "" },
        { status: "Approved", title: "Ready to send", empty: "Approve emails to add them here." },
      ]
    : [
        { status: "ChangesRequested", title: "Changes requested", empty: "" },
        { status: "Submitted", title: "In review", empty: "" },
        { status: "Approved", title: "Approved, going out soon", empty: "" },
      ];

  const marked = useListservAction((d) => {
    setMarkOpen(false);
    setSelectedId(null);
    const n = d.count ?? 0;
    toast.success(
      `${n} ${n === 1 ? "email" : "emails"} recorded as sent ${d.sentOn === today ? "today" : formatDay(d.sentOn!)}`,
    );
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegmentedTabButtons
          label="Listserv view"
          items={[
            { label: "In progress", count: queue.length, active: view === "queue", onClick: () => setView("queue") },
            { label: "Sent", count: sent.length, active: view === "sent", onClick: () => setView("sent") },
          ]}
        />
        <div className="flex items-center gap-2">
          {data.isAdmin && <IconButton label="Outreach lead and sending address" icon={Settings2} onClick={() => setConfigOpen(true)} />}
          <button type="button" className="os-add-btn" onClick={() => setComposer({ open: true, editing: null })}>
            <Plus className="h-4 w-4" strokeWidth={3} /> Submit an email
          </button>
        </div>
      </div>

      {view === "sent" ? (
        <SentHistory sent={sent} isLead={isLead} viewerId={viewerId} today={today} onOpen={setSelectedId} />
      ) : (
        <>
          <section className={cn(os.panel, "grid gap-6 p-6 md:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] md:items-center")}>
            {isLead ? (
              <div>
                <p className="font-heading text-3xl font-semibold text-foreground">
                  {ready.length} {ready.length === 1 ? "email" : "emails"} ready to send
                </p>
                <p className="mt-1.5 max-w-xl text-sm text-os-grey">
                  Send them from {data.fromAddress} in Gmail (open one and use Copy email), then mark them as sent here
                  so submitters know they went out.
                </p>
                {overdue.length > 0 && (
                  <p className="mt-2 text-sm text-destructive">
                    {overdue.length} {overdue.length === 1 ? "email is" : "emails are"} past the send-by date.
                  </p>
                )}
              </div>
            ) : (
              <div>
                <p className="font-heading text-3xl font-semibold text-foreground">
                  {mine.length === 0
                    ? "Nothing of yours in progress"
                    : `${mine.length} of your ${mine.length === 1 ? "emails is" : "emails are"} in progress`}
                </p>
                <p className="mt-1.5 max-w-xl text-sm text-os-grey">
                  {data.lead
                    ? `${leadName} reviews submissions and sends approved ones from ${data.fromAddress}.`
                    : `No outreach lead is set yet. An admin reviews submissions and sends them from ${data.fromAddress}.`}
                </p>
              </div>
            )}
            <div className="flex flex-col gap-3 md:border-l md:border-os-container/70 md:pl-6">
              <div className="text-sm">
                <p className="text-os-muted">Last sent</p>
                <p className="text-foreground">
                  {lastSentOn ? `${formatDay(lastSentOn)} · ${daysAgo(lastSentOn, today)}` : "Nothing yet"}
                </p>
              </div>
              {isLead && (
                <button
                  type="button"
                  className={cn(os.actionBtnPrimary, "self-start")}
                  disabled={ready.length === 0}
                  onClick={() => setMarkOpen(true)}
                >
                  <Check className={os.actionIcon} /> Mark as sent
                </button>
              )}
            </div>
          </section>

          {queue.length === 0 ? (
            <div className={cn(os.panel, "px-6 py-14 text-center")}>
              <p className="font-semibold text-foreground">All caught up</p>
              <p className="mt-1 text-sm text-os-muted">New submissions show up here.</p>
            </div>
          ) : (
            groups.map((g) => {
              const items = queue
                .filter((s) => s.status === g.status)
                .sort(
                  (a, b) =>
                    (isLead ? 0 : Number(b.submitter.id === viewerId) - Number(a.submitter.id === viewerId)) ||
                    bySendBy(a, b),
                );
              if (items.length === 0 && !g.empty) return null;
              return (
                <section key={g.status} className="flex flex-col gap-2" aria-label={g.title}>
                  <h2 className="px-1 text-sm font-semibold text-os-grey">
                    {g.title} <span className="font-normal text-os-muted">· {items.length}</span>
                  </h2>
                  {items.length === 0 ? (
                    <div className={cn(os.panel, "px-6 py-5 text-sm text-os-muted")}>{g.empty}</div>
                  ) : (
                    <SubmissionList submissions={items} isLead={isLead} viewerId={viewerId} today={today} onOpen={setSelectedId} />
                  )}
                </section>
              );
            })
          )}
        </>
      )}

      <SubmissionDetail
        submission={selected}
        data={data}
        onClose={() => setSelectedId(null)}
        onEdit={(s) => {
          setSelectedId(null);
          setComposer({ open: true, editing: s });
        }}
        onMarkSent={(id) => marked.run({ intent: "mark-sent", ids: [id], sentOn: today })}
      />

      <SubmissionComposer
        open={composer.open}
        editing={composer.editing}
        leadName={leadName}
        fromAddress={data.fromAddress}
        today={today}
        onClose={() => setComposer((c) => ({ ...c, open: false }))}
        onDone={(edited) => {
          setComposer({ open: false, editing: null });
          setView("queue");
          toast.success(edited ? "Submission updated" : `Submitted. ${leadName} will review it`);
        }}
      />

      <MarkSentModal
        open={markOpen}
        ready={ready}
        fromAddress={data.fromAddress}
        today={today}
        busy={marked.busy}
        onClose={() => setMarkOpen(false)}
        onConfirm={(ids, sentOn) => marked.run({ intent: "mark-sent", ids, sentOn })}
      />

      {data.isAdmin && <ConfigModal open={configOpen} data={data} onClose={() => setConfigOpen(false)} />}
    </div>
  );
}

function SentHistory({
  sent,
  isLead,
  viewerId,
  today,
  onOpen,
}: {
  sent: ListservRow[];
  isLead: boolean;
  viewerId: string;
  today: string;
  onOpen: (id: string) => void;
}) {
  const os = useOsChrome();
  const days = [...new Set(sent.map((s) => s.sentOn!))].sort().reverse();
  if (days.length === 0) {
    return <div className={cn(os.panel, "px-6 py-14 text-center text-sm text-os-muted")}>Nothing has been marked as sent yet.</div>;
  }
  return (
    <div className="flex flex-col gap-6">
      {days.map((day) => {
        const items = sent.filter((s) => s.sentOn === day);
        return (
          <section key={day} className="flex flex-col gap-2" aria-label={`Sent ${formatDay(day)}`}>
            <div className="flex flex-wrap items-baseline justify-between gap-2 px-1">
              <h2 className="text-sm font-semibold text-os-grey">
                Sent {formatDay(day)} <span className="font-normal text-os-muted">· {daysAgo(day, today)}</span>
              </h2>
              <span className="text-xs text-os-muted">
                {items.length} {items.length === 1 ? "email" : "emails"}
              </span>
            </div>
            <SubmissionList submissions={items} isLead={isLead} viewerId={viewerId} today={today} onOpen={onOpen} />
          </section>
        );
      })}
    </div>
  );
}

function SubmissionDetail({
  submission: s,
  data,
  onClose,
  onEdit,
  onMarkSent,
}: {
  submission: ListservRow | null;
  data: ListservData;
  onClose: () => void;
  onEdit: (s: ListservRow) => void;
  onMarkSent: (id: string) => void;
}) {
  const os = useOsChrome();
  const toast = useToast();
  const dialog = useDialog();
  const { isLead, today } = data;
  const [asking, setAsking] = useState(false);
  const [feedback, setFeedback] = useState("");
  useEffect(() => {
    setAsking(false);
    setFeedback("");
  }, [s?.id]);

  const act = useListservAction((d) => {
    const messages: Record<string, string> = {
      approve: "Approved. It moved to Ready to send",
      unapprove: "Approval undone",
      "request-changes": `Feedback sent to ${s?.submitter.name ?? "the submitter"}`,
      "unmark-sent": "Moved back to Ready to send",
      withdraw: "Submission withdrawn",
    };
    toast(messages[d.done] ?? "Done");
    setAsking(false);
    if (d.done === "withdraw") onClose();
  });

  const isOwn = s?.submitter.id === data.viewerId;
  const sent = s?.status === "Sent";

  const copy = async () => {
    if (!s) return;
    try {
      await navigator.clipboard.writeText(toPlainText(s));
      toast.success("Email copied. Paste it into Gmail");
    } catch {
      toast.error("Couldn't copy. Select the text instead");
    }
  };

  const withdraw = async () => {
    if (!s) return;
    const ok = await dialog.confirm({
      title: "Withdraw this submission?",
      description: "It's removed from the queue. You can submit it again later.",
      confirmLabel: "Withdraw",
      tone: "destructive",
    });
    if (ok) act.run({ intent: "withdraw", id: s.id });
  };

  let footer: ReactNode = undefined;
  if (s && sent) {
    footer = isLead ? (
      <div className="flex justify-end">
        <button type="button" className={os.actionBtn()} disabled={act.busy} onClick={() => act.run({ intent: "unmark-sent", id: s.id })}>
          <Undo2 className={os.actionIcon} /> Mark as not sent
        </button>
      </div>
    ) : undefined;
  } else if (s && asking) {
    footer = (
      <form
        className="flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (feedback.trim()) act.run({ intent: "request-changes", id: s.id, feedback: feedback.trim() });
        }}
      >
        <textarea
          autoFocus
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          rows={3}
          placeholder={`What should ${s.submitter.name.split(" ")[0]} change?`}
          aria-label="Requested changes"
          className={cn(os.compactField, "w-full resize-y border border-os-container px-3.5 py-2.5 text-sm")}
        />
        <div className="flex justify-end gap-2">
          <button type="button" className={os.actionBtn()} onClick={() => setAsking(false)}>
            Cancel
          </button>
          <button type="submit" className={os.actionBtnPrimary} disabled={!feedback.trim() || act.busy}>
            Send feedback
          </button>
        </div>
      </form>
    );
  } else if (s && (isLead || isOwn)) {
    footer = (
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-2">
          {isOwn && (
            <>
              <button type="button" className={os.actionBtn()} onClick={() => onEdit(s)}>
                <Pencil className={os.actionIcon} /> Edit
              </button>
              <button type="button" className={os.actionBtn()} disabled={act.busy} onClick={withdraw}>
                <Trash2 className={os.actionIcon} /> Withdraw
              </button>
            </>
          )}
        </div>
        {isLead && (
          <div className="flex gap-2">
            {s.status === "Approved" ? (
              <>
                <button type="button" className={os.actionBtn()} disabled={act.busy} onClick={() => act.run({ intent: "unapprove", id: s.id })}>
                  Undo approval
                </button>
                <button type="button" className={os.actionBtnPrimary} onClick={() => onMarkSent(s.id)}>
                  <Check className={os.actionIcon} /> Mark as sent
                </button>
              </>
            ) : (
              <>
                {s.status !== "ChangesRequested" && (
                  <button type="button" className={os.actionBtn()} onClick={() => setAsking(true)}>
                    <MessageSquareWarning className={os.actionIcon} /> Request changes
                  </button>
                )}
                <button type="button" className={os.actionBtnPrimary} disabled={act.busy} onClick={() => act.run({ intent: "approve", id: s.id })}>
                  <Check className={os.actionIcon} /> Approve
                </button>
              </>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <Drawer open={s !== null} onClose={onClose} title="Submission" footer={footer}>
      {s && (
        <div className="flex flex-col gap-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <Pill dot={STATUS_DOT[s.status]}>{statusLabel(s.status, isLead)}</Pill>
              {sent && s.sentOn ? (
                <span className="text-sm text-os-grey">Sent {formatDay(s.sentOn)}</span>
              ) : (
                s.sendBy && (
                  <span className={cn("text-sm", URGENCY_TEXT[urgency(s.sendBy, today)])}>{sendByLabel(s.sendBy, today)}</span>
                )
              )}
            </div>
            {isLead && (
              <button type="button" className={os.actionBtn()} onClick={copy}>
                <Copy className={os.actionIcon} /> Copy email
              </button>
            )}
          </div>

          {s.feedback && !sent && (
            <div className="rounded-os-item bg-os-amber/10 px-4 py-3 text-sm text-os-amber">
              <p className="font-semibold">Changes requested</p>
              <p className="mt-0.5 whitespace-pre-line">{s.feedback}</p>
            </div>
          )}

          <article className="overflow-hidden rounded-os-item border border-os-container bg-os-well">
            <dl className="flex flex-col gap-1.5 border-b border-os-container px-5 py-4 text-sm">
              <div className="flex gap-3">
                <dt className="w-14 shrink-0 text-os-muted">From</dt>
                <dd className="text-foreground">DALI Lab &lt;{data.fromAddress}&gt;</dd>
              </div>
              <div className="flex gap-3">
                <dt className="w-14 shrink-0 text-os-muted">Subject</dt>
                <dd className="font-semibold text-foreground">{s.subject}</dd>
              </div>
            </dl>
            <EmailBody content={s.content} attachments={s.attachments} />
          </article>

          <dl className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <dt className="text-xs text-os-muted">Submitted by</dt>
              <dd className="text-foreground">{s.submitter.name}</dd>
            </div>
            <div>
              <dt className="text-xs text-os-muted">Submitted</dt>
              <dd className="text-foreground">
                {new Date(s.submittedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
              </dd>
            </div>
          </dl>

          {s.note && (
            <div className="rounded-os-item bg-os-container/50 px-4 py-3 text-sm">
              <p className="text-xs text-os-muted">Note for the outreach lead</p>
              <p className="mt-0.5 whitespace-pre-line text-foreground">{s.note}</p>
            </div>
          )}
        </div>
      )}
    </Drawer>
  );
}

const emptyDraft = (): ListservDraft => ({
  subject: "",
  content: [{ id: newBlockId(), type: "text", text: "" }],
  attachments: [],
  sendBy: "",
  note: "",
});

function SubmissionComposer({
  open,
  editing,
  leadName,
  fromAddress,
  today,
  onClose,
  onDone,
}: {
  open: boolean;
  editing: ListservRow | null;
  leadName: string;
  fromAddress: string;
  today: string;
  onClose: () => void;
  onDone: (edited: boolean) => void;
}) {
  const os = useOsChrome();
  const [draft, setDraft] = useState<ListservDraft>(emptyDraft);
  const [tried, setTried] = useState(false);
  const save = useListservAction(() => onDone(Boolean(editing)));

  useEffect(() => {
    if (!open) return;
    setTried(false);
    setDraft(
      editing
        ? {
            subject: editing.subject,
            content: editing.content,
            attachments: editing.attachments.map(({ key, name, size }) => ({ key, name, size })),
            sendBy: editing.sendBy ?? "",
            note: editing.note ?? "",
          }
        : emptyDraft(),
    );
  }, [open, editing]);

  const errors = {
    subject: !draft.subject.trim() ? "Add a subject line" : "",
    body: !hasContent(draft.content) ? "Write the email or add an image" : "",
  };

  const submit = () => {
    setTried(true);
    if (errors.subject || errors.body) return;
    save.run({ intent: editing ? "edit" : "submit", id: editing?.id ?? "", draft: JSON.stringify(draft) });
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={editing ? "Edit submission" : "Submit to the listserv"}
      footer={
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-os-muted">Sent from {fromAddress}</p>
          <div className="flex gap-2">
            <button type="button" className={os.actionBtn()} onClick={onClose}>
              Cancel
            </button>
            <button type="button" className={os.actionBtnPrimary} disabled={save.busy} onClick={submit}>
              {editing?.status === "ChangesRequested" ? "Resubmit" : editing ? "Save changes" : "Submit for review"}
            </button>
          </div>
        </div>
      }
    >
      <form
        className={cn(os.formClass, "flex flex-col gap-6")}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {editing?.feedback && (
          <div className="rounded-os-item bg-os-amber/10 px-4 py-3 text-sm text-os-amber">
            <p className="font-semibold">{leadName} asked for changes</p>
            <p className="mt-0.5 whitespace-pre-line">{editing.feedback}</p>
          </div>
        )}
        {editing?.status === "Approved" && (
          <p className="text-sm text-os-grey">Saving sends it back to review, since it changed after approval.</p>
        )}

        <label className={os.fieldLabel}>
          Subject
          <input
            value={draft.subject}
            onChange={(e) => setDraft({ ...draft, subject: e.target.value })}
            maxLength={300}
            placeholder="Include the what, when and where"
          />
          {tried && errors.subject && <span className="text-xs text-destructive">{errors.subject}</span>}
        </label>

        <div className="flex flex-col gap-1.5">
          <span className="text-sm text-os-grey">Email</span>
          <EmailBodyEditor
            blocks={draft.content}
            onChange={(content) => setDraft((d) => ({ ...d, content }))}
            invalid={tried && Boolean(errors.body)}
          />
          {tried && errors.body && <span className="text-xs text-destructive">{errors.body}</span>}
        </div>

        <AttachmentsField attachments={draft.attachments} onChange={(attachments) => setDraft((d) => ({ ...d, attachments }))} />

        <div className={os.fieldLabel}>
          Needs to go out by (optional)
          <div className="flex items-center gap-2">
            <DateField
              mode="date"
              value={draft.sendBy}
              min={today}
              onChange={(sendBy) => setDraft((d) => ({ ...d, sendBy }))}
              ariaLabel="Send by"
              className="sm:w-56"
              buttonClassName={os.formTrigger}
            />
            {draft.sendBy && (
              <button type="button" className={os.actionBtn()} onClick={() => setDraft((d) => ({ ...d, sendBy: "" }))}>
                Clear
              </button>
            )}
          </div>
          <span className="text-xs text-os-muted">Add a date only if it's time-sensitive.</span>
        </div>

        <label className={os.fieldLabel}>
          Note for the outreach lead (optional)
          <textarea
            value={draft.note}
            onChange={(e) => setDraft({ ...draft, note: e.target.value })}
            rows={2}
            maxLength={2000}
            placeholder="Timing, or who to ask about details"
          />
        </label>
      </form>
    </Drawer>
  );
}

const MARK_TITLE = "listserv-mark-sent-title";

function MarkSentModal({
  open,
  ready,
  fromAddress,
  today,
  busy,
  onClose,
  onConfirm,
}: {
  open: boolean;
  ready: ListservRow[];
  fromAddress: string;
  today: string;
  busy: boolean;
  onClose: () => void;
  onConfirm: (ids: string[], sentOn: string) => void;
}) {
  const os = useOsChrome();
  const [picked, setPicked] = useState<string[]>([]);
  const [sentOn, setSentOn] = useState(today);
  useEffect(() => {
    if (!open) return;
    setPicked(ready.map((s) => s.id));
    setSentOn(today);
  }, [open, ready, today]);
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  return (
    <Modal open={open} onClose={onClose} labelledBy={MARK_TITLE} containerClassName={modalCardClass("max-w-lg")}>
      <ModalHeader titleId={MARK_TITLE} title="Mark emails as sent" onClose={onClose} />
      <div className="flex flex-col gap-5">
        <p className={os.bodyText}>
          Tick the emails you sent from <span className="text-foreground">{fromAddress}</span>. Submitters see they went
          out, and they move to Sent.
        </p>
        <ul className="flex flex-col divide-y divide-os-container/70 rounded-os-item bg-os-well">
          {ready.map((s) => (
            <li key={s.id} className="px-4 py-3">
              <Checkbox
                tone="os"
                checked={picked.includes(s.id)}
                onChange={() => toggle(s.id)}
                className="w-full"
                label={
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-foreground">{s.subject}</span>
                    <span className="block text-xs text-os-muted">{s.submitter.name}</span>
                  </span>
                }
              />
            </li>
          ))}
        </ul>
        <div className={os.fieldLabel}>
          Sent on
          <DateField
            mode="date"
            value={sentOn}
            max={today}
            onChange={(v) => v && setSentOn(v)}
            ariaLabel="Sent on"
            className="sm:w-56"
            buttonClassName={os.formTrigger}
          />
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" className={os.actionBtn()} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className={os.actionBtnPrimary}
            disabled={picked.length === 0 || busy}
            onClick={() => onConfirm(picked, sentOn)}
          >
            <Check className={os.actionIcon} /> Mark {picked.length} as sent
          </button>
        </div>
      </div>
    </Modal>
  );
}

const CONFIG_TITLE = "listserv-config-title";

function ConfigModal({ open, data, onClose }: { open: boolean; data: ListservData; onClose: () => void }) {
  const os = useOsChrome();
  const toast = useToast();
  const [leadUserId, setLeadUserId] = useState(data.lead?.id ?? "");
  const [fromAddress, setFromAddress] = useState(data.fromAddress);
  const save = useListservAction(() => {
    toast.success("Listserv settings saved");
    onClose();
  });
  return (
    <Modal open={open} onClose={onClose} labelledBy={CONFIG_TITLE} containerClassName={modalCardClass("max-w-md")}>
      <ModalHeader
        titleId={CONFIG_TITLE}
        title="Listserv settings"
        subtitle="Who reviews submissions and where they go out from. Admins can always review too."
        onClose={onClose}
      />
      <div className={cn(os.formClass, "flex flex-col gap-5")}>
        <div className={os.fieldLabel}>
          Outreach lead
          <Combobox
            value={leadUserId}
            ariaLabel="Outreach lead"
            placeholder="Pick a member"
            options={data.candidates.map((c) => ({ value: c.id, label: c.name }))}
            onChange={setLeadUserId}
          />
        </div>
        <label className={os.fieldLabel}>
          Sends from
          <input value={fromAddress} onChange={(e) => setFromAddress(e.target.value)} type="email" />
        </label>
        <div className="flex justify-end gap-2">
          <button type="button" className={os.actionBtn()} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className={os.actionBtnPrimary}
            disabled={save.busy}
            onClick={() => save.run({ intent: "set-config", leadUserId, fromAddress })}
          >
            Save
          </button>
        </div>
      </div>
    </Modal>
  );
}
