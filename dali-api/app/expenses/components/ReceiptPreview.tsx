import { useState } from "react";
import { FileText } from "lucide-react";
import { cn } from "~/lib/cn";
import { RECEIPT_KIND_LABEL } from "./format";
import type { ReceiptView } from "./types";

export function ReceiptPreview({ receipts }: { receipts: ReceiptView[] }) {
  const [index, setIndex] = useState(0);
  const current = receipts[Math.min(index, receipts.length - 1)];
  if (!current) return null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex min-h-72 items-center justify-center overflow-hidden rounded-os-card bg-os-well">
        {!current.url ? (
          <p className="text-sm text-os-grey">Preview isn't available right now.</p>
        ) : current.contentType === "application/pdf" ? (
          <iframe src={current.url} title={RECEIPT_KIND_LABEL[current.kind]} className="h-[28rem] w-full" />
        ) : (
          <img src={current.url} alt={RECEIPT_KIND_LABEL[current.kind]} className="max-h-[28rem] w-full object-contain" />
        )}
      </div>
      {receipts.length > 1 && (
        <ul className="flex gap-2 overflow-x-auto" aria-label="Receipts">
          {receipts.map((r, i) => (
            <li key={r.id}>
              <button
                type="button"
                aria-current={i === index}
                onClick={() => setIndex(i)}
                className={cn(
                  "flex w-24 flex-col items-center gap-1 rounded-lg border p-1.5 text-xs",
                  i === index ? "border-os-accent text-foreground" : "border-os-container text-os-grey hover:text-foreground",
                )}
              >
                {r.url && r.contentType !== "application/pdf" ? (
                  <img src={r.url} alt="" className="h-14 w-full rounded object-cover" />
                ) : (
                  <span className="grid h-14 w-full place-items-center rounded bg-os-well">
                    <FileText className="h-5 w-5" aria-hidden />
                  </span>
                )}
                {RECEIPT_KIND_LABEL[r.kind]}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
