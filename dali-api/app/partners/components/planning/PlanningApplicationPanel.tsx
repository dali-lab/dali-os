import { Link } from "react-router";
import type { PlanningApplicationInfo } from "../../lib/planning-gap.server";
import { PlanBlock, spotsKey, type CoreMember, type DomainOption } from "./PlanBlock";
import { noteMeta, SavedTextField } from "./SavedTextField";

export function PlanningApplicationPanel({
  applicationId,
  info,
  coreMembers,
  domains,
  canEdit,
}: {
  applicationId: string;
  info: PlanningApplicationInfo;
  coreMembers: CoreMember[];
  domains: DomainOption[];
  canEdit: boolean;
}) {
  const terms = info.targetTermCodes;
  return (
    <div className="flex flex-col gap-4">
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
          hint="Set the PI in the panel on the right. The PI and spots carry over to the project when it is created."
          pi={info.pi}
          spots={info.spots}
          coreMembers={coreMembers}
          domains={domains}
          canEdit={canEdit}
          piFields={null}
          spotsFields={{ intent: "application-spots", applicationId }}
          saveSpotsLabel="Save spots"
        />
      </section>
    </div>
  );
}
