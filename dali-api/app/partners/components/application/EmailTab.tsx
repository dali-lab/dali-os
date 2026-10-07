// Email tab, shared by PartnerApplicationModal and the full page. Behind the
// partner-email flag — when it's off, or the account has no threads yet, a
// plain empty state explains why instead of rendering nothing.

import { PartnerEmailPanel } from "../PartnerEmailPanel";
import type { ApplicationEmailThread } from "../../lib/partner-application-detail";

export function EmailTab({
  contactId,
  threads,
  partnerEmailOn,
}: {
  contactId: string;
  threads: ApplicationEmailThread[];
  partnerEmailOn: boolean;
}) {
  if (!partnerEmailOn) {
    return (
      <p className="text-sm text-muted-foreground">
        The partners@ inbox isn't connected. Turn on the partner-email flag in Admin to capture and show email here.
      </p>
    );
  }
  if (threads.length === 0) {
    return <p className="text-sm text-muted-foreground">No email with this contact yet.</p>;
  }
  return <PartnerEmailPanel contactId={contactId} threads={threads} />;
}
