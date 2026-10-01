import { useEffect, useState } from "react";
import { useFetcher } from "react-router";
import { TriangleAlert } from "lucide-react";
import { Modal, ModalFooter, ModalHeader } from "~/components/Modal";
import { modalCardClass } from "~/components/os-chrome";
import { Button } from "~/components/ui/Button";
import { Checkbox } from "~/components/ui/Checkbox";
import { connectHref } from "~/email/components/AccountsModal";
import {
  PERSONAL_MAIL_CONSENT_LABEL,
  PERSONAL_MAIL_NOTICE,
  PERSONAL_MAIL_NOTICE_VERSION,
} from "~/email/lib/personal-notice";

// The opt-in a member completes before their personal DALI mailbox connects.
// Agreement is recorded server-side first; the Google sign-in refuses without it.
export function PersonalInboxConsent({ address, onClose }: { address: string; onClose: () => void }) {
  const fetcher = useFetcher<{ consented?: boolean; error?: string }>();
  const [agreed, setAgreed] = useState(false);
  const busy = fetcher.state !== "idle" || Boolean(fetcher.data?.consented);

  useEffect(() => {
    if (fetcher.data?.consented) window.location.assign(connectHref("personal"));
  }, [fetcher.data]);

  return (
    <Modal open onClose={onClose} labelledBy="personal-inbox-title" containerClassName={modalCardClass("max-w-lg")}>
      <ModalHeader titleId="personal-inbox-title" title="Connect your DALI email" subtitle={address} onClose={onClose} />
      <div
        role="note"
        aria-labelledby="personal-inbox-notice"
        className="flex flex-col gap-2 rounded-os-item border border-os-amber/50 bg-os-well p-4"
      >
        <p id="personal-inbox-notice" className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <TriangleAlert className="h-4 w-4 shrink-0 text-os-amber" />
          Notice and assumption of risk
        </p>
        {PERSONAL_MAIL_NOTICE.map((paragraph) => (
          <p key={paragraph} className="text-xs leading-relaxed text-foreground">
            {paragraph}
          </p>
        ))}
      </div>
      <Checkbox
        className="mt-4"
        checked={agreed}
        onChange={(e) => setAgreed(e.target.checked)}
        label={PERSONAL_MAIL_CONSENT_LABEL}
      />
      {fetcher.data?.error && <p className="mt-2 text-xs text-destructive">{fetcher.data.error}</p>}
      <ModalFooter onCancel={onClose}>
        <Button
          disabled={!agreed || busy}
          onClick={() =>
            fetcher.submit(
              { intent: "consentPersonal", agreed: PERSONAL_MAIL_NOTICE_VERSION },
              { method: "post", action: "/email" },
            )
          }
        >
          Agree and connect
        </Button>
      </ModalFooter>
    </Modal>
  );
}
