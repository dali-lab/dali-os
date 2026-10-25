import { useEffect, useState } from "react";
import { useFetcher } from "react-router";
import { ShieldCheck, X } from "lucide-react";
import { Modal } from "~/components/Modal";
import { modalCardClass } from "~/components/os-chrome";
import { buttonClasses } from "~/components/ui/Button";
import { IconButton } from "~/components/ui/IconButton";
import type { loader as accessLoader } from "~/journeys/routes/journeys.access";
import { accessPath } from "~/journeys/lib/paths";
import { JourneyAccessDetail } from "./JourneyAccess";

/** Who can edit one journey, opened from that journey's Access button. */
export function AccessButton({ journeyId, variant = "icon" }: { journeyId: string; variant?: "icon" | "button" }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {variant === "icon" ? (
        <IconButton label="Access" icon={ShieldCheck} onClick={() => setOpen(true)} />
      ) : (
        <button type="button" onClick={() => setOpen(true)} className={buttonClasses("secondary", "sm")}>
          <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
          Access
        </button>
      )}
      {open && <AccessDialog journeyId={journeyId} onClose={() => setOpen(false)} />}
    </>
  );
}

function AccessDialog({ journeyId, onClose }: { journeyId: string; onClose: () => void }) {
  const fetcher = useFetcher<typeof accessLoader>();
  useEffect(() => {
    fetcher.load(accessPath(journeyId));
    // Load once per journey; the router reloads it after each access change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [journeyId]);
  const loaded = fetcher.data;

  return (
    <Modal open onClose={onClose} labelledBy="journey-access-title" containerClassName={modalCardClass("max-w-2xl")}>
      <div className="mb-2 flex items-center justify-between">
        <h2 id="journey-access-title" className="text-xs font-semibold uppercase tracking-widest text-os-grey">
          Access
        </h2>
        <IconButton label="Close" icon={X} onClick={onClose} />
      </div>
      {loaded && "entry" in loaded ? (
        <JourneyAccessDetail entry={loaded.entry} people={loaded.people} viewerId={loaded.viewerId} />
      ) : (
        <p className="py-10 text-center text-sm text-os-grey">Loading</p>
      )}
    </Modal>
  );
}
