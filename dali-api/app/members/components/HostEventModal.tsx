import { useEffect, useId, useState } from "react";
import { useFetcher } from "react-router";
import { Button } from "~/components/ui/Button";
import { DateField } from "~/components/ui/DateField";
import { Segmented } from "~/components/ui/Segmented";
import { TimeField } from "~/components/ui/TimeField";
import { Toggle } from "~/components/ui/Toggle";
import { useToast } from "~/components/ui/toast";
import { Field, FieldPair } from "~/components/ui/modal-fields";
import { Modal, ModalFooter, ModalHeader } from "~/components/Modal";
import type { CommunityEvent } from "~/members/lib/community.server";
import { wallClockFields } from "~/members/lib/community-view";

type FormState = {
  title: string;
  date: string;
  startTime: string;
  endTime: string;
  mode: "inPerson" | "online";
  placeName: string;
  address: string;
  meetingUrl: string;
  audience: "alumni" | "alumni_and_students";
  description: string;
  notifyNearby: boolean;
};

const BLANK: FormState = {
  title: "",
  date: "",
  startTime: "18:00",
  endTime: "19:00",
  mode: "inPerson",
  placeName: "",
  address: "",
  meetingUrl: "",
  audience: "alumni_and_students",
  description: "",
  notifyNearby: false,
};

function fromEvent(e: CommunityEvent, tz: string): FormState {
  const start = wallClockFields(e.startsAt, tz);
  const end = wallClockFields(e.endsAt, tz);
  return {
    title: e.title,
    date: start.date,
    startTime: start.time,
    endTime: end.time,
    mode: e.online ? "online" : "inPerson",
    placeName: e.placeName ?? "",
    address: e.address ?? "",
    meetingUrl: e.meetingUrl ?? "",
    audience: e.audience ?? "alumni_and_students",
    description: e.description ?? "",
    notifyNearby: e.notifyNearby,
  };
}

const INPUT_CLASS =
  "w-full rounded-[10px] border border-border bg-background px-3.5 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-os-accent/40";

function clientError(f: FormState): string | null {
  if (!f.title.trim()) return "Give the event a name.";
  if (!f.date) return "Pick a date.";
  return null;
}

export function HostEventModal({
  event,
  tz,
  open,
  onClose,
}: {
  event: CommunityEvent | null;
  tz: string;
  open: boolean;
  onClose: () => void;
}) {
  const fetcher = useFetcher<{ ok: boolean; error?: string; message?: string }>();
  const toast = useToast();
  const titleId = useId();
  const [form, setForm] = useState<FormState>(BLANK);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setForm(event ? fromEvent(event, tz) : BLANK);
      setLocalError(null);
    }
  }, [open, event, tz]);

  useEffect(() => {
    if (fetcher.data?.ok) {
      toast.success(event ? "Event updated." : "Event posted.");
      onClose();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.data]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));
  const busy = fetcher.state !== "idle";
  const error = localError ?? (fetcher.data && !fetcher.data.ok ? (fetcher.data.error ?? null) : null);

  function submit() {
    const invalid = clientError(form);
    setLocalError(invalid);
    if (invalid) return;
    fetcher.submit(
      {
        intent: event ? "update-event" : "create-event",
        ...(event ? { eventId: event.id } : {}),
        ...form,
        notifyNearby: form.notifyNearby ? "on" : "off",
      },
      { method: "post" },
    );
  }

  return (
    <Modal open={open} onClose={onClose} labelledBy={titleId} disableEscape={busy}>
      <ModalHeader titleId={titleId} title={event ? "Edit event" : "Host an event"} onClose={onClose} />
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        noValidate
      >
        <Field label="Name">
          <input
            className={INPUT_CLASS}
            value={form.title}
            onChange={(e) => set("title", e.target.value)}
            maxLength={120}
          />
        </Field>

        <div className="os-field-group">
          <span className="os-field-label">When</span>
          <div className="flex flex-wrap items-center gap-2">
            <DateField mode="date" value={form.date} onChange={(v) => set("date", v)} ariaLabel="Date" />
            <TimeField value={form.startTime} onChange={(v) => set("startTime", v)} ariaLabel="Start time" />
            <span className="text-sm text-os-grey">to</span>
            <TimeField value={form.endTime} onChange={(v) => set("endTime", v)} ariaLabel="End time" />
          </div>
        </div>

        <div className="os-field-group">
          <span className="os-field-label">Where</span>
          <Segmented
            value={form.mode}
            onChange={(v) => set("mode", v)}
            options={[
              { value: "inPerson", label: "In person" },
              { value: "online", label: "Online" },
            ]}
            ariaLabel="Where"
            className="self-start"
          />
          {form.mode === "inPerson" ? (
            <FieldPair>
              <Field label="Place name">
                <input className={INPUT_CLASS} value={form.placeName} onChange={(e) => set("placeName", e.target.value)} />
              </Field>
              <Field label="Address">
                <input className={INPUT_CLASS} value={form.address} onChange={(e) => set("address", e.target.value)} />
              </Field>
            </FieldPair>
          ) : (
            <Field label="Link">
              <input
                className={INPUT_CLASS}
                value={form.meetingUrl}
                onChange={(e) => set("meetingUrl", e.target.value)}
                placeholder="https://"
              />
            </Field>
          )}
        </div>

        <div className="os-field-group">
          <span className="os-field-label">Who can come</span>
          <Segmented
            value={form.audience}
            onChange={(v) => set("audience", v)}
            options={[
              { value: "alumni", label: "Alumni" },
              { value: "alumni_and_students", label: "Alumni and students" },
            ]}
            ariaLabel="Who can come"
            className="self-start"
          />
        </div>

        <Field label="About">
          <textarea
            className={`${INPUT_CLASS} resize-y`}
            rows={3}
            value={form.description}
            onChange={(e) => set("description", e.target.value)}
          />
        </Field>

        <Toggle
          tone="os"
          label="Tell people nearby"
          description="Only people who turned on nearby events get it."
          checked={form.notifyNearby}
          onChange={(e) => set("notifyNearby", e.target.checked)}
        />

        {error && (
          <p role="alert" className="text-sm text-os-red">
            {error}
          </p>
        )}

        <p className="text-xs text-os-muted">It goes on the map when you post. You can edit or cancel it anytime.</p>

        <ModalFooter onCancel={onClose} cancelDisabled={busy} className="mt-2">
          <Button type="submit" disabled={busy}>
            {event ? "Save changes" : "Post event"}
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
