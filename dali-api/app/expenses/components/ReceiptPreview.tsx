import { useState } from "react";
import { ExternalLink, FileText, Maximize2 } from "lucide-react";
import { FileViewer, type ViewerFile } from "~/components/ui/FileViewer";
import { IconButton } from "~/components/ui/IconButton";
import { Tooltip } from "~/components/ui/floating";
import { cn } from "~/lib/cn";
import { RECEIPT_KIND_LABEL } from "./format";
import type { ReceiptView } from "./types";

const isPdf = (r: ReceiptView) => r.contentType === "application/pdf";

export function toViewerFile(r: ReceiptView): ViewerFile {
  return isPdf(r)
    ? { id: r.id, title: RECEIPT_KIND_LABEL[r.kind], kind: "pdf", src: r.fileUrl, href: r.fileUrl }
    : { id: r.id, title: RECEIPT_KIND_LABEL[r.kind], kind: "image", src: r.url, href: r.fileUrl };
}

export function ReceiptPreview({ receipts }: { receipts: ReceiptView[] }) {
  const [index, setIndex] = useState(0);
  const [viewing, setViewing] = useState(false);
  const current = receipts[Math.min(index, receipts.length - 1)];
  if (!current) return null;
  const file = toViewerFile(current);

  return (
    <div className="flex flex-col gap-3">
      <div className="relative flex min-h-72 items-center justify-center overflow-hidden rounded-os-card bg-os-well">
        {!file.src ? (
          <p className="text-sm text-os-grey">Preview isn't available right now.</p>
        ) : file.kind === "pdf" ? (
          <iframe src={file.src} title={file.title} className="h-[28rem] w-full" />
        ) : (
          <button type="button" aria-label={`View ${file.title} larger`} onClick={() => setViewing(true)} className="w-full cursor-zoom-in">
            <img src={file.src} alt={file.title} className="max-h-[28rem] w-full object-contain" />
          </button>
        )}
        {file.src && (
          <div className="absolute right-2 top-2 flex gap-1 rounded-md bg-os-card/90">
            <IconButton label="Open viewer" icon={Maximize2} onClick={() => setViewing(true)} />
            <Tooltip content="Open in a new tab">
              <a href={current.fileUrl} target="_blank" rel="noreferrer" aria-label="Open in a new tab" className="os-icon-btn">
                <ExternalLink className="h-4 w-4" aria-hidden />
              </a>
            </Tooltip>
          </div>
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
                {r.url && !isPdf(r) ? (
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
      <FileViewer files={receipts.map(toViewerFile)} index={index} onIndexChange={setIndex} open={viewing} onClose={() => setViewing(false)} />
    </div>
  );
}
