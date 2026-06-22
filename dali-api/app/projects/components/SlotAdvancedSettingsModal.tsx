// Advanced settings modal for a staffing slot (Project Bids / Intent to
// Work). Wraps the form picker + column mapper so a manager opens them
// on-demand from the board header instead of those panels taking up vertical
// real estate above every page load. Viewers (Core/Admin without staffing
// management) can still open it to see the current binding/columns
// read-only — both inner components already render that way when canManage
// is false.
import { Modal, ModalHeader } from "~/components/Modal";
import { SlotFormPicker } from "./SlotFormPicker";
import { SlotColumnMapper } from "./SlotColumnMapper";
import type { Slot } from "~/projects/lib/form-slots";
import type { ColumnMapping } from "~/projects/lib/slot-roles";

type SelectableForm = { id: string; name: string; published: boolean };

type Binding = {
  formId: string;
  formName: string;
  published: boolean;
  publicToken: string | null;
  mapping: ColumnMapping | null;
} | null;

type FormQuestion = {
  key: string;
  label: string;
  type: string;
  referenceSource?: string;
};

export function SlotAdvancedSettingsModal({
  open,
  onClose,
  slot,
  slotLabel,
  binding,
  selectableForms,
  formQuestions,
  cycleTerms,
  canManage,
}: {
  open: boolean;
  onClose: () => void;
  slot: Slot;
  slotLabel: string;
  binding: Binding;
  selectableForms: SelectableForm[];
  formQuestions: FormQuestion[];
  cycleTerms: { id: string; code: string }[];
  canManage: boolean;
}) {
  const titleId = `slot-advanced-${slot}`;
  return (
    <Modal
      open={open}
      onClose={onClose}
      labelledBy={titleId}
      containerClassName="bg-card rounded-2xl shadow-xl w-full max-w-3xl p-5 sm:p-6 my-auto"
    >
      <ModalHeader
        titleId={titleId}
        title={`${slotLabel} settings`}
        subtitle="Connect the form members fill, then map its questions to the columns shown on the board."
        onClose={onClose}
        closeLabel="Close settings"
      />

      <div className="flex flex-col gap-4 max-h-[70vh] overflow-y-auto pr-1">
        <SlotFormPicker
          slotLabel={slotLabel}
          binding={binding}
          forms={selectableForms}
          canManage={canManage}
        />
        {binding && (
          <SlotColumnMapper
            slot={slot}
            questions={formQuestions}
            mapping={binding.mapping}
            cycleTerms={cycleTerms}
            canManage={canManage}
          />
        )}
        {!binding && (
          <p className="text-xs text-muted-foreground">
            Connect a form first to configure its columns.
          </p>
        )}
      </div>

      <div className="mt-4 flex justify-end">
        <button
          type="button"
          onClick={onClose}
          className="px-3 py-1.5 text-sm font-medium rounded-md border border-border text-foreground hover:bg-muted"
        >
          Done
        </button>
      </div>
    </Modal>
  );
}
