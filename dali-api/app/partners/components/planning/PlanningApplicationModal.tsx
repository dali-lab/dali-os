import { Link } from "react-router";
import { Modal, ModalHeader } from "~/components/Modal";
import { Button } from "~/components/ui/Button";
import { ProjectIcon } from "~/components/ProjectIcon";
import type { PlanningApplicationInfo } from "../../lib/planning-gap.server";
import { applicationHref } from "./DomainBreakdown";
import { noteMeta, SavedTextField } from "./SavedTextField";

export function PlanningApplicationModal({
  applicationId,
  info,
  canEdit,
  onClose,
}: {
  applicationId: string;
  info: PlanningApplicationInfo;
  canEdit: boolean;
  onClose: () => void;
}) {
  return (
    <Modal open onClose={onClose} labelledBy="planning-application-title">
      <ModalHeader
        titleId="planning-application-title"
        title={
          <span className="flex min-w-0 items-center gap-2">
            <ProjectIcon iconEmoji={info.iconEmoji} />
            <span className="min-w-0 truncate">{info.title}</span>
          </span>
        }
        subtitle={info.partnerName ?? undefined}
        onClose={onClose}
        closeLabel="Close application info"
      />

      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="rounded-full bg-os-container/70 px-2 py-0.5 font-medium text-foreground">{info.stage}</span>
          <span>Application</span>
        </div>

        <SavedTextField
          key={`note:${info.note?.updatedAt ?? ""}`}
          title="Planning notes"
          label="Planning notes"
          placeholder="What's going on with this application right now?"
          hint="Only shown here on Planning."
          value={info.note?.body ?? null}
          meta={noteMeta(info.note)}
          fields={{ intent: "note", ownerKind: "application", ownerId: applicationId }}
          bodyField="body"
          saveLabel="Save notes"
          canEdit={canEdit}
        />

        <div className="flex items-center justify-between pt-2">
          <Link to={applicationHref(applicationId)} className="text-sm font-medium text-os-accent hover:underline">
            Open on the Partners board →
          </Link>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </Modal>
  );
}
