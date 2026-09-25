import { useId, type ReactNode } from "react";
import { Form } from "react-router";
import { Modal, ModalHeader } from "~/components/Modal";
import { modalCardClass } from "~/components/os-chrome";
import { Button } from "~/components/ui/Button";

// Every "add X" on the manage page opens one of these instead of expanding a
// form under the list. Inline composers pushed the content you were reading out
// of the way and left four half-filled forms competing for the page; a modal
// takes the one thing you're creating and gets out of the way when it's done.
//
// The body is whatever fields the caller passes. Submitting posts the form
// normally (the manage route's action handles every intent), and the modal
// closes optimistically on submit — the action revalidates the page behind it.

export function AddFormModal({
  open,
  onClose,
  title,
  subtitle,
  intent,
  submitLabel,
  children,
  hiddenFields,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  /** Action intent posted with the form. */
  intent: string;
  submitLabel: string;
  children: ReactNode;
  /** Extra hidden inputs, e.g. studentEditable on a shared doc. */
  hiddenFields?: Record<string, string>;
}) {
  const titleId = useId();
  return (
    <Modal
      open={open}
      onClose={onClose}
      labelledBy={titleId}
      containerClassName={modalCardClass("max-w-lg")}
    >
      <ModalHeader titleId={titleId} title={title} subtitle={subtitle} onClose={onClose} />
      {/* `os-form` dresses every field the caller passes — native inputs and
          the Select / DateField triggers alike — so an "add X" modal never
          hand-rolls its own field classes. */}
      <Form
        method="post"
        onSubmit={() => queueMicrotask(onClose)}
        className="os-form flex flex-col gap-4"
      >
        <input type="hidden" name="intent" value={intent} />
        {Object.entries(hiddenFields ?? {}).map(([name, value]) => (
          <input key={name} type="hidden" name={name} value={value} />
        ))}
        {children}
        <div className="flex items-center justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="os-btn-ghost">
            Cancel
          </button>
          <Button type="submit">{submitLabel}</Button>
        </div>
      </Form>
    </Modal>
  );
}
