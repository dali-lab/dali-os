import { SharedInboxPanel } from "~/email/components/SharedInboxPanel";
import type { EmailEngagement } from "~/hiring/lib/email-engagement.server";

// Subjects and the thread pointer are already stripped server-side while the
// viewer is blinded, so this component renders whatever it's handed.
export function ApplicantEmailPanel({
  engagement,
  blinded,
  applicationId,
  defaultOpen,
}: {
  engagement: EmailEngagement | null;
  blinded: boolean;
  applicationId: string;
  defaultOpen?: boolean;
}) {
  if (!engagement) return null;

  return (
    <SharedInboxPanel
      title="Email with applications@"
      threads={engagement.threads}
      threadUrl={(indexId) => `/api/hiring/applications/${applicationId}/email-thread/${indexId}`}
      emptyLabel={blinded ? "Subject hidden during blind review" : "(no subject)"}
      defaultOpen={defaultOpen}
    />
  );
}
