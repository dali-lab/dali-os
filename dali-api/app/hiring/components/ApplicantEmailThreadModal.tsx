import { SharedInboxThreadModal } from "~/email/components/SharedInboxThreadModal";

// Thin wrapper over SharedInboxThreadModal pointed at the hiring thread
// route — kept as its own component (rather than inlined at the one call
// site) so hiring code keeps a stable, hiring-named import.
export function ApplicantEmailThreadModal({
  applicationId,
  indexId,
  onClose,
}: {
  applicationId: string;
  indexId: string;
  onClose: () => void;
}) {
  return (
    <SharedInboxThreadModal
      url={`/api/hiring/applications/${applicationId}/email-thread/${indexId}`}
      onClose={onClose}
    />
  );
}
