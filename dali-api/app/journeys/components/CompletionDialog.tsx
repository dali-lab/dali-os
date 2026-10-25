import { Link } from "react-router";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import { Modal } from "~/components/Modal";
import { buttonClasses } from "~/components/ui/Button";
import { moduleTitle } from "~/journeys/lib/journey";
import type { JourneyModule } from "~/journeys/lib/types";

export function CompletionDialog({
  open,
  moduleName,
  basePath,
  unlocked,
  journeyDone,
  onClose,
}: {
  open: boolean;
  moduleName: string;
  basePath: string;
  unlocked: JourneyModule[];
  journeyDone: boolean;
  onClose: () => void;
}) {
  return (
    <Modal open={open} onClose={onClose} labelledBy="completion-title">
      <CheckCircle2 className="h-10 w-10 text-os-green" aria-hidden />
      <h2 id="completion-title" className="mt-4 font-heading text-2xl font-semibold">
        Module complete
      </h2>
      <p className="mt-2 text-os-grey">
        You finished <span className="text-foreground">{moduleName}</span>.
      </p>
      {unlocked.length > 0 ? (
        <div className="mt-6">
          <p className="text-xs font-medium text-os-muted">Now unlocked</p>
          <ul className="mt-1 divide-y divide-os-container">
            {unlocked.map((m) => (
              <li key={m.id}>
                <Link
                  to={`${basePath}/${m.id}`}
                  onClick={onClose}
                  className="flex items-center justify-between gap-3 py-3 text-sm transition-colors hover:text-os-accent"
                >
                  <span>
                    {moduleTitle(m)}
                    <span className="block text-xs text-os-muted">{m.duration}</span>
                  </span>
                  <ArrowRight className="h-4 w-4 shrink-0" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="mt-4 text-sm text-os-grey">
          {journeyDone
            ? "That was the last module in this journey. Nice work."
            : "Other modules in this journey are still waiting for you."}
        </p>
      )}
      <div className="mt-8 flex flex-wrap gap-3">
        <Link to={basePath} className={buttonClasses("primary", "md")}>
          Back to journey
        </Link>
        <button type="button" onClick={onClose} className={buttonClasses("ghost", "md")}>
          Stay here
        </button>
      </div>
    </Modal>
  );
}
