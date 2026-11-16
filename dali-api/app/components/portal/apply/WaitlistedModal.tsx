import { Modal } from "~/components/Modal";
import { buttonClasses } from "~/components/ui/Button";
import { Pill } from "~/components/ui/Pill";
import type { WaitlistedApplicationOption } from "~/hiring/lib/continued-interest.server";

export type WaitlistedModalProps = {
  open: boolean;
  onClose: () => void;
  reusing: boolean;
  options: WaitlistedApplicationOption[];
  continuedFrom: Record<string, string>;
  onReuse: (option: WaitlistedApplicationOption) => void;
};

export function WaitlistedModal({ open, onClose, reusing, options, continuedFrom, onReuse }: WaitlistedModalProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      labelledBy="waitlisted-modal-title"
      disableEscape={reusing}
    >
      <h3 id="waitlisted-modal-title" className="font-heading text-base font-bold text-foreground mb-1">
        Use a waitlisted application
      </h3>
      <p className="text-sm text-muted-foreground mb-4">
        Pick one to apply with it again. It replaces your general answers and that domain's answers
        here, and you fill out a short continued interest form.
      </p>
      <ul className="flex flex-col gap-2">
        {options.map(option => {
          const inUse = !!continuedFrom[option.domainId];
          return (
            <li key={option.domainApplicationId}>
              <button
                type="button"
                disabled={reusing || inUse}
                onClick={() => onReuse(option)}
                className="flex w-full items-center justify-between gap-4 rounded-os-item bg-os-well px-4 py-3 text-left transition-colors hover:bg-os-card-hover disabled:opacity-60 disabled:hover:bg-os-well"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-foreground">
                    {option.domainName}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {option.cycleName} · Waitlisted{" "}
                    {new Date(option.waitlistedAt).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </span>
                </span>
                {inUse && <Pill outline>In use</Pill>}
              </button>
            </li>
          );
        })}
      </ul>
      <div className="flex justify-end pt-5">
        <button
          type="button"
          onClick={onClose}
          disabled={reusing}
          className={buttonClasses("secondary")}
        >
          Cancel
        </button>
      </div>
    </Modal>
  );
}
