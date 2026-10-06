import { SharedInboxPanel } from "~/email/components/SharedInboxPanel";
import type { PartnerEmailThread } from "~/partners/lib/partner-email.server";

// "Email with partners@" panel for a contact record / the CRM Email tab.
// Thin wrapper over SharedInboxPanel — no blind review in the Partner CRM,
// so every thread always carries a real subject and indexId.
export function PartnerEmailPanel({
  contactId,
  threads,
}: {
  contactId: string;
  threads: PartnerEmailThread[];
}) {
  if (threads.length === 0) return null;

  return (
    <SharedInboxPanel
      title="Email with partners@"
      threads={threads}
      threadUrl={(indexId) => `/api/partner-contacts/${contactId}/email-thread/${indexId}`}
      emptyLabel="(no subject)"
    />
  );
}
