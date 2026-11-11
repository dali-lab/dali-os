import { Link } from "react-router";
import { Modal, ModalHeader } from "~/components/Modal";
import { Button } from "~/components/ui/Button";
import { ProjectIcon } from "~/components/ProjectIcon";
import type { PlanningApplicationInfo } from "../../lib/planning-gap.server";
import { applicationHref } from "./DomainBreakdown";
import { PlanBlock, spotsKey, type CoreMember, type DomainOption } from "./PlanBlock";
import { noteMeta, SavedTextField } from "./SavedTextField";

export function PlanningApplicationModal({
  applicationId,
  info,
  coreMembers,
  domains,
  canEdit,
  onClose,
}: {
  applicationId: string;
  info: PlanningApplicationInfo;
  coreMembers: CoreMember[];
  domains: DomainOption[];
  canEdit: boolean;
  onClose: () => void;
}) {
  const terms = info.targetTermCodes;
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
          <span>{info.continues ? "Returning project" : "Application"}</span>
        </div>

        {info.continues && (
          <p className="rounded-os-card bg-os-container/40 p-3 text-sm text-foreground">
            Return of{" "}
            <Link to={`/projects/${info.continues.projectId}`} className="font-medium text-os-accent hover:underline">
              {info.continues.name}
            </Link>
            {info.continues.lastTermCode && <span className="text-muted-foreground"> (last ran {info.continues.lastTermCode})</span>}
            . Accepting it reopens this project for its target terms.
          </p>
        )}

        <SavedTextField
          key={`summary:${info.summary ?? ""}`}
          title="Summary"
          label="Application summary"
          placeholder="Add a short summary of the pitch"
          value={info.summary}
          fields={{ intent: "application-summary", applicationId }}
          bodyField="summary"
          saveLabel="Save summary"
          canEdit={canEdit}
        />

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

        <section className="flex flex-col gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">If it goes ahead</h3>
          <PlanBlock
            key={spotsKey(info.spots)}
            title={terms.length > 0 ? `Wants ${terms.join(", ")}` : "No target terms yet"}
            label="Application"
            hint="The PI and spots carry over to the project when it is created."
            pi={info.pi}
            spots={info.spots}
            coreMembers={coreMembers}
            domains={domains}
            canEdit={canEdit}
            piFields={{ intent: "application-pi", applicationId }}
            spotsFields={{ intent: "application-spots", applicationId }}
            saveSpotsLabel="Save spots"
          />
        </section>

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
