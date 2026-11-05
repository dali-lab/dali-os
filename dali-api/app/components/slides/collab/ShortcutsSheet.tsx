import { Modal, ModalHeader } from "~/components/Modal";
import { isMac, keysOf, SHORTCUT_GROUPS, SHORTCUTS } from "./shortcuts";

export function ShortcutsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const mac = isMac();
  return (
    <Modal open={open} onClose={onClose} labelledBy="slide-shortcuts-title" containerClassName="w-full max-w-2xl rounded-os-card bg-os-card p-5 shadow-xl">
      <ModalHeader titleId="slide-shortcuts-title" title="Keyboard shortcuts" onClose={onClose} className="mb-3" />
      <div className="grid max-h-[70vh] gap-6 overflow-y-auto sm:grid-cols-2">
        {SHORTCUT_GROUPS.map((group) => (
          <section key={group} aria-label={group} className="flex flex-col gap-1.5">
            <h3 className="text-xs font-medium text-os-grey">{group}</h3>
            <dl className="flex flex-col gap-1">
              {SHORTCUTS.filter((s) => s.group === group).map((def) => (
                <div key={def.id} data-shortcut={def.id} className="flex items-center justify-between gap-3 text-sm">
                  <dt>{def.label}</dt>
                  <dd className="flex flex-wrap items-center justify-end gap-1.5">
                    {keysOf(def, mac).map((keys, i) => (
                      <span key={i} className="flex items-center gap-0.5">
                        {keys.map((key) => (
                          <kbd key={key} className="rounded-md border border-os-container bg-os-hover px-1.5 py-0.5 font-sans text-xs text-os-fg">
                            {key}
                          </kbd>
                        ))}
                      </span>
                    ))}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Modal>
  );
}
