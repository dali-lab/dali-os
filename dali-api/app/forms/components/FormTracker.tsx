import { useEffect, useState } from "react";
import { useFetcher } from "react-router";
import { Modal, ModalHeader } from "~/components/Modal";
import { modalCardClass } from "~/components/os-chrome";
import { Avatar } from "~/components/ui/Avatar";
import { Button } from "~/components/ui/Button";
import { FormField } from "~/components/ui/FormField";
import { useToast } from "~/components/ui/toast";
import type { TrackerList } from "~/forms/lib/form-tracker.server";
import {
  defaultReminderMessage,
  dismissedNote,
  plural,
  remindLabel,
  remindablePeople,
  reminderBlock,
  reminderBlockMessage,
  trackerSubtitle,
  type TrackerCounts,
} from "~/forms/lib/form-tracker";

const TITLE_ID = "form-tracker-title";

export function FormTracker({
  formId,
  counts,
}: {
  formId: string;
  counts: TrackerCounts;
}) {
  const [open, setOpen] = useState(false);
  const notResponded = counts.expected - counts.responded;

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
      <div
        role="progressbar"
        aria-label="Expected people who responded"
        aria-valuemin={0}
        aria-valuemax={counts.expected}
        aria-valuenow={counts.responded}
        className="h-1.5 w-40 overflow-hidden rounded-full bg-os-well"
      >
        <div
          className="h-full rounded-full bg-os-accent"
          style={{ width: `${(counts.responded / counts.expected) * 100}%` }}
        />
      </div>
      <span className="text-os-grey">
        <strong className="font-semibold text-foreground">
          {counts.responded} of {counts.expected}
        </strong>{" "}
        expected {plural(counts.expected, "person", "people")} responded
      </span>
      {notResponded > 0 && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="font-medium text-os-accent hover:underline"
        >
          {notResponded} not responded
        </button>
      )}
      {open && <TrackerModal formId={formId} onClose={() => setOpen(false)} />}
    </div>
  );
}

function TrackerModal({ formId, onClose }: { formId: string; onClose: () => void }) {
  const loader = useFetcher<{ list: TrackerList | null }>();
  const sender = useFetcher<{ ok?: true; sent?: number; error?: string }>();
  const toast = useToast();
  const [composing, setComposing] = useState(false);
  const [message, setMessage] = useState("");
  const href = `/forms/edit/${formId}?tracker=list`;

  useEffect(() => {
    loader.load(href);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [href]);

  const sent = sender.data && "sent" in sender.data ? sender.data.sent : undefined;
  useEffect(() => {
    if (sent === undefined) return;
    toast.success(`Reminder sent to ${sent} ${plural(sent, "person", "people")}.`);
    setComposing(false);
    loader.load(href);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sent]);

  const list = loader.data?.list ?? null;
  const now = new Date();
  const closesAt = list?.closesAt ? new Date(list.closesAt) : null;
  const lastRemindedAt = list?.lastRemindedAt ? new Date(list.lastRemindedAt) : null;
  const remindable = list
    ? remindablePeople(
        list.notResponded.map((p) => ({ ...p, responded: false })),
      ).length
    : 0;
  const dismissed = list ? list.notResponded.length - remindable : 0;
  const block = list
    ? reminderBlock({ published: list.published, lastRemindedAt, remindable, now })
    : null;
  const sending = sender.state !== "idle";
  const error = sender.data && "error" in sender.data ? sender.data.error : null;

  function startComposing() {
    if (!list) return;
    setMessage(defaultReminderMessage(list.formName, closesAt));
    setComposing(true);
  }

  return (
    <Modal open onClose={onClose} labelledBy={TITLE_ID} containerClassName={modalCardClass("max-w-[480px]")}>
      {!list ? (
        <>
          <ModalHeader titleId={TITLE_ID} title="Not responded" onClose={onClose} />
          <p className="text-sm text-os-grey">
            {loader.state === "idle" && loader.data ? "Nobody is expected to respond." : "Loading…"}
          </p>
        </>
      ) : composing ? (
        <>
          <ModalHeader
            titleId={TITLE_ID}
            title={remindLabel(remindable)}
            subtitle={list.formName}
            onClose={onClose}
          />
          <div className="os-form">
            <FormField
              label="Message"
              value={message}
              onChange={setMessage}
              multiline
              rows={4}
              hint="Sent as a notification with a link to the form. Each person's notification settings apply."
            />
          </div>
          {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
          <div className="mt-6 flex items-center justify-end gap-2">
            <Button variant="ghost" onClick={() => setComposing(false)} disabled={sending}>
              Back
            </Button>
            <Button
              onClick={() => sender.submit({ intent: "send-form-reminder", message }, { method: "post", action: `/forms/edit/${formId}` })}
              disabled={sending || message.trim() === ""}
            >
              {sending ? "Sending…" : "Send reminder"}
            </Button>
          </div>
        </>
      ) : (
        <>
          <ModalHeader
            titleId={TITLE_ID}
            title="Not responded"
            subtitle={trackerSubtitle(list.notResponded.length, list.expected, closesAt)}
            onClose={onClose}
          />
          <ul className="max-h-60 overflow-y-auto">
            {list.notResponded.map((p) => (
              <li
                key={p.userId}
                className={`flex h-10 items-center gap-2.5 ${p.dismissed ? "opacity-60" : ""}`}
              >
                <Avatar photoUrl={p.photoUrl} name={p.name} size="compact" />
                <span className="min-w-0 flex-1 truncate text-sm text-foreground">{p.name}</span>
                {p.dismissed && (
                  <span className="rounded-full bg-os-well px-2 py-0.5 text-[11px] text-os-grey">
                    Dismissed
                  </span>
                )}
                <span className="max-w-[40%] truncate text-right text-xs text-os-grey">
                  {p.sources.join(", ")}
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-6 flex items-center justify-between gap-4">
            <p className="text-xs text-os-grey">
              {block ? reminderBlockMessage(block, lastRemindedAt, now) : dismissedNote(dismissed)}
            </p>
            <Button className="shrink-0" onClick={startComposing} disabled={block !== null}>
              {remindLabel(remindable)}
            </Button>
          </div>
        </>
      )}
    </Modal>
  );
}
