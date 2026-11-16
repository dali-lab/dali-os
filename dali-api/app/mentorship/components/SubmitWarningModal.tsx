import { useState } from "react";
import { Modal, ModalFooter, ModalHeader } from "~/components/Modal";
import { DateField } from "~/components/ui/DateField";
import { Field } from "~/components/ui/modal-fields";
import { Select } from "~/components/ui/floating";
import { useToast } from "~/components/ui/toast";
import { modalCardClass } from "~/components/os-chrome";
import { WARNING_REASONS, validateWarning, type WarningReason } from "../lib/warnings";

const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export function SubmitWarningModal({
  member,
  onClose,
  onSubmitted,
}: {
  member: { id: string; name: string };
  onClose: () => void;
  onSubmitted?: () => void;
}) {
  const toast = useToast();
  const [reason, setReason] = useState<WarningReason>("missed_meeting");
  const [notes, setNotes] = useState("");
  const [date, setDate] = useState(todayIso());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const titleId = "submit-warning-title";

  async function submit() {
    const invalid = validateWarning({ memberId: member.id, reason, notes, occurredOn: date });
    if (invalid) return setError(invalid);
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/mentorship/warnings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memberId: member.id, reason, notes, occurredOn: date }),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(d?.error ?? "Couldn't submit the warning. Try again.");
        return;
      }
      toast.success(`Warning submitted for ${member.name}.`);
      onSubmitted?.();
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} labelledBy={titleId} disableEscape={busy} containerClassName={modalCardClass("max-w-md")}>
      <ModalHeader titleId={titleId} title={`Submit a warning for ${member.name}`} onClose={onClose} />
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Field label="Reason">
          <Select
            value={reason}
            options={WARNING_REASONS.map((r) => ({ value: r.value, label: r.label }))}
            onChange={(v) => setReason(v as WarningReason)}
            ariaLabel="Reason"
          />
        </Field>
        <Field label={reason === "other" ? "Notes (required)" : "Notes"}>
          <textarea
            rows={4}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="What happened?"
          />
        </Field>
        <Field label="Date">
          <DateField mode="date" value={date} onChange={setDate} ariaLabel="Date" />
        </Field>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <ModalFooter onCancel={onClose} cancelDisabled={busy}>
          <button type="submit" className="os-btn-primary os-btn-primary--sm" disabled={busy}>
            {busy ? "Submitting…" : "Submit warning"}
          </button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
