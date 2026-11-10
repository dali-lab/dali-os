import { PartnerEmailPanel } from "../PartnerEmailPanel";
import type { ApplicationEmailThread } from "../../lib/partner-application-detail";

export function EmailTab({
  contactId,
  threads,
}: {
  contactId: string;
  threads: ApplicationEmailThread[];
}) {
  if (threads.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No email yet. Threads with this contact from partners@ show up here.
      </p>
    );
  }
  return <PartnerEmailPanel contactId={contactId} threads={threads} />;
}
