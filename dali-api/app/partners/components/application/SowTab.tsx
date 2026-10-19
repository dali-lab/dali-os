// The Statement of work tab, shared by PartnerApplicationModal and the full
// page: its state and next action on top, the co-drafted doc below. One collab
// doc per application; versioning comes from the collab snapshot machinery.

import { DocEditor } from "~/components/doc";
import { PresenceProvider } from "~/components/collab/PresenceProvider";
import { SowStatePanel, type PartnerSowState } from "./SowStatePanel";

export function SowTab({
  applicationId,
  sowState,
  canEdit,
  collabToken,
  userName,
  onChanged,
}: {
  applicationId: string;
  sowState: PartnerSowState;
  canEdit: boolean;
  collabToken: string | null;
  userName: string;
  onChanged: () => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <SowStatePanel applicationId={applicationId} sowState={sowState} canEdit={canEdit} onChanged={onChanged} />
      {collabToken ? (
        <PresenceProvider pageId={`partnersow:${applicationId}`} token={collabToken} userName={userName}>
          <DocEditor
            features="notes"
            editable={canEdit}
            placeholder="Draft the statement of work…"
            className="rounded-xl border bg-os-card py-2"
            collab={{ documentName: `partnersow:${applicationId}:body`, token: collabToken, userName }}
          />
        </PresenceProvider>
      ) : (
        <p className="text-sm text-os-grey">Sign in again to edit the statement of work.</p>
      )}
    </div>
  );
}
