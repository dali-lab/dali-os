import { SharedInboxPanel } from "~/email/components/SharedInboxPanel";
import type { EmailEngagement } from "~/hiring/lib/email-engagement.server";

// "Email with applications@" panel on the hiring application views. Thin
// wrapper over SharedInboxPanel: subjects and the thread pointer are already
// stripped server-side while the viewer is blinded (getApplicantEmailEngagement),
// so this only has to pick the blinded-vs-plain fallback label.
export function ApplicantEmailPanel({
  engagement,
  blinded,
  applicationId,
}: {
  engagement: EmailEngagement | null;
  blinded: boolean;
  applicationId: string;
}) {
  if (!engagement) return null;

  return (
    <SharedInboxPanel
      title="Email with applications@"
      threads={engagement.threads}
      threadUrl={(indexId) => `/api/hiring/applications/${applicationId}/email-thread/${indexId}`}
      emptyLabel={blinded ? "Subject hidden during blind review" : "(no subject)"}
    />
  );
}
