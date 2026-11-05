import { useState } from "react";
import { Modal, ModalFooter, ModalHeader } from "~/components/Modal";
import { Button } from "~/components/ui/Button";
import { FormField } from "~/components/ui/FormField";
import { cleanSection } from "~/components/slides/deck/slide-meta";

export function SectionNameModal({ title, initial = "", confirmLabel, onSubmit, onClose }: { title: string; initial?: string; confirmLabel: string; onSubmit: (name: string) => void; onClose: () => void }) {
  const [value, setValue] = useState(initial);
  const name = cleanSection(value);
  return (
    <Modal open onClose={onClose} labelledBy="slide-section-title" containerClassName="w-full max-w-sm rounded-os-card bg-os-card p-5 shadow-xl">
      <ModalHeader titleId="slide-section-title" title={title} onClose={onClose} className="mb-3" />
      <form
        className="os-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (name) onSubmit(name);
        }}
      >
        <FormField label="Section name" value={value} onChange={setValue} placeholder="Introduction" />
        <ModalFooter onCancel={onClose}>
          <Button type="submit" size="sm" disabled={!name}>
            {confirmLabel}
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
