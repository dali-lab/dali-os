import { useEffect, useState } from "react";
import { Modal, ModalHeader } from "~/components/Modal";
import { TemplateLibrary } from "./TemplateLibrary";
import { fetchScopeTemplates, type TemplateRow } from "./templates-client";

/** Lists the saved decks a new deck can start from. */
export function NewDeckFromTemplate({ open, projectId, onPick, onClose }: { open: boolean; projectId: string | null; onPick: (row: TemplateRow) => void; onClose: () => void }) {
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoaded(false);
    void fetchScopeTemplates(projectId).then((rows) => {
      if (cancelled) return;
      setTemplates(rows);
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [open, projectId]);
  return (
    <Modal open={open} onClose={onClose} labelledBy="deck-template-title" containerClassName="w-full max-w-md rounded-os-card bg-os-card p-5 shadow-xl">
      <ModalHeader titleId="deck-template-title" title="New deck from template" onClose={onClose} className="mb-3" />
      <TemplateLibrary templates={templates} loaded={loaded} kind="Deck" onPick={onPick} />
    </Modal>
  );
}
