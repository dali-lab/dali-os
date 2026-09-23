import { useEffect, useState } from "react";
import { Send, X } from "lucide-react";
import { Modal } from "~/components/Modal";
import { useToast } from "~/components/ui/toast";
import { modalCardClass } from "~/components/os-chrome";
import { cn } from "~/lib/cn";

// Core-only bulk nudge: Slack-DM every mentor who hasn't filled in their notes
// in the current term/filter view. The recipient list is computed by the host
// (browse) page from the grid it already holds and shown here so Core sees who
// will be messaged before sending; the action re-derives the list server-side.

const DEFAULT_INTRO =
  "This is a reminder to fill in your weekly mentorship notes.";

const TITLE_ID = "mentorship-nudge-modal-title";

export type NudgeRecipient = { name: string; count: number };

type NudgeResult = {
  messaged: string[];
  skippedNoSlack: string[];
  sentInEnv: boolean;
};

export function NudgeModal({
  open,
  onClose,
  termId,
  projectId,
  domainId,
  recipients,
}: {
  open: boolean;
  onClose: () => void;
  termId: string;
  projectId: string;
  domainId: string;
  recipients: NudgeRecipient[];
}) {
  const toast = useToast();
  const [intro, setIntro] = useState(DEFAULT_INTRO);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setIntro(DEFAULT_INTRO);
      setBusy(false);
    }
  }, [open]);

  async function send() {
    setBusy(true);
    try {
      const res = await fetch("/api/mentorship/nudge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ termId, projectId, domainId, intro }),
      });
      if (!res.ok) throw new Error(`nudge failed: ${res.status}`);
      const data = (await res.json()) as NudgeResult;
      if (!data.sentInEnv) {
        toast(
          "Slack DMs are prod-only — nothing was sent in this environment.",
          { variant: "info" },
        );
      } else {
        const skipped = data.skippedNoSlack.length
          ? ` ${data.skippedNoSlack.length} had no linked Slack.`
          : "";
        toast.success(
          `Messaged ${data.messaged.length} mentor${
            data.messaged.length === 1 ? "" : "s"
          }.${skipped}`,
        );
      }
      onClose();
    } catch {
      toast.error("Couldn't send the reminders. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      labelledBy={TITLE_ID}
      disableEscape={busy}
      containerClassName={modalCardClass("max-w-lg flex flex-col !p-0")}
    >
      <div className="flex items-start justify-between gap-4 px-5 sm:px-6 py-4 border-b border-border">
        <div>
          <h2
            id={TITLE_ID}
            className="font-heading text-foreground text-xl font-medium"
          >
            Message mentors who haven&apos;t filled in
          </h2>
          <p className="text-muted-foreground mt-1 text-sm">
            Sends a Slack DM (and an in-app reminder) to each mentor with an
            unfilled note this term, listing exactly which ones are missing.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="os-icon-btn"
        >
          <X className="w-5 h-5" aria-hidden />
        </button>
      </div>

      <div className="flex flex-col gap-4 px-5 sm:px-6 py-4">
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="text-foreground font-medium">Message</span>
          <textarea
            value={intro}
            onChange={(e) => setIntro(e.target.value)}
            rows={3}
            className={cn(
              "w-full resize-y rounded-os-item border border-os-container bg-transparent px-3 py-2 text-sm text-foreground",
              "focus:outline-none focus:border-os-accent",
            )}
          />
          <span className="text-xs text-muted-foreground">
            Each mentor&apos;s outstanding notes are appended automatically.
          </span>
        </label>

        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-foreground">
            Recipients ({recipients.length})
          </span>
          {recipients.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Everyone in this view is caught up — no one to message.
            </p>
          ) : (
            <ul className="max-h-48 overflow-y-auto flex flex-col gap-0.5 rounded-os-item border border-border p-2">
              {recipients.map((r) => (
                <li
                  key={r.name}
                  className="flex items-center justify-between gap-2 px-1.5 py-1 text-sm"
                >
                  <span className="truncate text-foreground">{r.name}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {r.count} unfilled
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="flex items-center justify-end gap-2 px-5 sm:px-6 py-4 border-t border-border">
        <button type="button" onClick={onClose} className="os-btn-ghost">
          Cancel
        </button>
        <button
          type="button"
          onClick={send}
          disabled={busy || recipients.length === 0}
          className="os-btn-primary disabled:opacity-50"
        >
          <Send className="w-4 h-4" aria-hidden />
          {busy ? "Sending…" : "Send reminders"}
        </button>
      </div>
    </Modal>
  );
}
