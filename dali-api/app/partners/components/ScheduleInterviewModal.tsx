// STUB: replaced by feat/partner-crm-sched
//
// Temporary placeholder so the board and the application modal can call the
// real scheduler's contract (specs/partner-crm.md §6) before it lands. Takes
// the exact named export another branch will fill in with the refactored
// CreateEventModal (mode: "meeting-only").

import { Modal } from "~/components/Modal";
import { buttonClasses } from "~/components/ui/Button";
import { modalCardClass } from "~/components/os-chrome";

export function ScheduleInterviewModal({
  applicationId,
  partnerName,
  partnerEmail,
  onClose,
  onScheduled,
}: {
  applicationId: string;
  partnerName: string;
  partnerEmail: string;
  onClose: () => void;
  onScheduled: () => void;
}) {
  // Unused until the real scheduler lands — keeps the contract's params in
  // the type signature without tripping noUnusedParameters.
  void applicationId;
  void partnerName;
  void partnerEmail;
  void onScheduled;

  return (
    <Modal
      open
      onClose={onClose}
      labelledBy="schedule-interview-stub-title"
      containerClassName={modalCardClass("max-w-sm")}
    >
      <h2 id="schedule-interview-stub-title" className="text-lg font-semibold text-foreground">
        Scheduler loading
      </h2>
      <p className="mt-2 text-sm text-muted-foreground">
        The interview scheduler isn't wired up yet in this build.
      </p>
      <div className="mt-4 flex justify-end">
        <button type="button" onClick={onClose} className={buttonClasses("secondary", "sm")}>
          Close
        </button>
      </div>
    </Modal>
  );
}
