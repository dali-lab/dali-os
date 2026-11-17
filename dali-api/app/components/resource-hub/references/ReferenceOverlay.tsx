import { ExternalLink } from "lucide-react";
import { Modal, ModalHeader } from "~/components/Modal";
import { modalCardClass } from "~/components/os-chrome";
import { FilePreview } from "~/components/FilePreview";
import type { ReferenceView } from "~/lib/references.server";
import { DaliMadeBadge } from "./ReferenceCard";

export function ReferenceOverlay({ item, onClose }: { item: ReferenceView; onClose: () => void }) {
  const credit = [item.creatorName, item.daliMade ? null : `Shared by ${item.sharedBy}`].filter(Boolean).join(" · ");
  return (
    <Modal open onClose={onClose} labelledBy="reference-overlay-title" containerClassName={modalCardClass("max-w-5xl")}>
      <ModalHeader
        titleId="reference-overlay-title"
        title={item.title}
        subtitle={credit || undefined}
        onClose={onClose}
        className="!mb-4"
        actions={
          item.kind === "file" ? (
            <a href={item.url} target="_blank" rel="noopener noreferrer" className="os-btn-ghost inline-flex items-center gap-1.5 text-sm">
              Open original
              <ExternalLink className="h-3.5 w-3.5" aria-hidden />
            </a>
          ) : undefined
        }
      />
      {item.kind === "image" ? (
        <img src={item.url} alt={item.title} className="mx-auto block max-h-[75vh] max-w-full rounded-lg border border-os-container bg-os-bg object-contain" />
      ) : (
        <FilePreview previewUrl={item.url} downloadUrl={item.url} fileName={item.fileName ?? item.title} />
      )}
      {(item.note || item.daliMade) && (
        <div className="mt-4 flex flex-wrap items-start gap-3">
          {item.daliMade && <DaliMadeBadge />}
          {item.note && <p className="min-w-0 flex-1 text-sm text-foreground [overflow-wrap:anywhere]">{item.note}</p>}
        </div>
      )}
    </Modal>
  );
}
