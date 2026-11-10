import { useState } from "react";
import { Modal, ModalFooter, ModalHeader } from "~/components/Modal";
import { Button } from "~/components/ui/Button";
import { FormField } from "~/components/ui/FormField";
import { Segmented } from "~/components/ui/Segmented";

export interface SaveTemplateModalProps {
  open: boolean;
  kind: "Deck" | "Slide";
  slideCount: number;
  defaultTitle: string;
  canSaveToProject: boolean;
  onSave: (title: string, scope: "lab" | "project") => Promise<string | null>;
  onClose: () => void;
}

export function SaveTemplateModal({ open, kind, slideCount, defaultTitle, canSaveToProject, onSave, onClose }: SaveTemplateModalProps) {
  const [title, setTitle] = useState(defaultTitle);
  const [scope, setScope] = useState<"lab" | "project">("lab");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const valid = title.trim() !== "";
  const noun = kind === "Deck" ? "deck" : slideCount === 1 ? "slide" : "slides";
  return (
    <Modal open={open} onClose={onClose} labelledBy="slide-template-title" containerClassName="w-full max-w-md rounded-os-card bg-os-card p-5 shadow-xl">
      <ModalHeader titleId="slide-template-title" title={kind === "Deck" ? "Save as template" : "Save to library"} onClose={onClose} className="mb-3" />
      <form
        className="os-form"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!valid || busy) return;
          setBusy(true);
          const message = await onSave(title.trim(), scope);
          setBusy(false);
          if (message) setError(message);
        }}
      >
        <FormField label="Name" value={title} onChange={setTitle} hint={`Anyone in the lab can start from this ${noun}.`} />
        {canSaveToProject && (
          <Segmented
            ariaLabel="Who can use it"
            value={scope}
            onChange={setScope}
            options={[
              { value: "lab", label: "The lab" },
              { value: "project", label: "This project" },
            ]}
          />
        )}
        {error && (
          <p role="alert" className="text-sm text-os-red">
            {error}
          </p>
        )}
        <ModalFooter onCancel={onClose}>
          <Button type="submit" size="sm" disabled={!valid || busy}>
            Save
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
