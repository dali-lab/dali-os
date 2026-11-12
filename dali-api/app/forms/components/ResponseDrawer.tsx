import type { ReactNode } from "react";
import { Drawer } from "~/components/ui/Drawer";

export type DrawerField = {
  key: string;
  label: string;
  value: string;
  files?: { name: string; key: string }[];
  // Shown under the label, e.g. that the column is hidden from the table.
  note?: string;
};

// One response in full, opened from a row of the responses table on form
// results and the staffing boards.
export function ResponseDrawer({
  open,
  onClose,
  title,
  subtitle,
  fields,
  lead,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  fields: DrawerField[];
  lead?: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <Drawer open={open} onClose={onClose} title={title} footer={footer}>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
        {subtitle && <p className="-mt-2 mb-4 text-xs text-muted-foreground">{subtitle}</p>}
        {lead}
        <dl className="flex flex-col gap-4">
          {fields.map((f) => (
            <div key={f.key}>
              <dt className="mb-0.5 text-xs font-medium text-muted-foreground">
                {f.label}
                {f.note && <span className="ml-1.5 font-normal text-os-grey">{f.note}</span>}
              </dt>
              <dd className="whitespace-pre-wrap text-sm text-foreground">
                {f.files?.length ? (
                  <span className="flex flex-col gap-1">
                    {f.files.map((file) => (
                      <a
                        key={file.key}
                        href={`/api/upload/raw?key=${encodeURIComponent(file.key)}`}
                        target="_blank"
                        rel="noreferrer"
                        className="break-all text-os-accent hover:underline"
                      >
                        {file.name}
                      </a>
                    ))}
                  </span>
                ) : (
                  f.value || "—"
                )}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </Drawer>
  );
}
