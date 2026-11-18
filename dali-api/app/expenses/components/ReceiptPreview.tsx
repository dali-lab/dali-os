import { useState } from "react";
import { FileText, Maximize2 } from "lucide-react";
import { FileViewer, type ViewerFile } from "~/components/ui/FileViewer";
import { IconButton } from "~/components/ui/IconButton";
import { OpenInNewTab } from "~/components/ui/OpenInNewTab";
import { cn } from "~/lib/cn";
import { RECEIPT_KIND_LABEL } from "./format";
import type { ReceiptView } from "./types";

const isPdf = (r: ReceiptView) => r.contentType === "application/pdf";

export async function fetchReceiptLink(fileUrl: string): Promise<string> {
  const res = await fetch(`${fileUrl}?link=1`, { credentials: "same-origin" });
  const body = (await res.json().catch(() => null)) as { url?: unknown } | null;
  if (!res.ok || typeof body?.url !== "string") throw new Error("Receipt link unavailable");
  return body.url;
}

export function toViewerFile(r: ReceiptView): ViewerFile {
  const externalHref = () => fetchReceiptLink(r.fileUrl);
  return isPdf(r)
    ? { id: r.id, title: RECEIPT_KIND_LABEL[r.kind], kind: "pdf", src: r.fileUrl, href: r.fileUrl, externalHref }
    : { id: r.id, title: RECEIPT_KIND_LABEL[r.kind], kind: "image", src: r.url, href: r.fileUrl, externalHref };
}

export function ReceiptPreview({ receipts }: { receipts: ReceiptView[] }) {
  const [index, setIndex] = useState(0);
  const [viewing, setViewing] = useState(false);
  const current = receipts[Math.min(index, receipts.length - 1)];
  if (!current) return null;
  const file = toViewerFile(current);

  return (
    <div className="flex flex-col gap-3">
      {file.src && (
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm text-os-grey">{file.title}</span>
          <div className="flex gap-1">
            <IconButton label="Open viewer" icon={Maximize2} onClick={() => setViewing(true)} />
            <OpenInNewTab href={current.fileUrl} externalHref={file.externalHref} />
          </div>
        </div>
      )}
      <div className="flex min-h-72 items-center justify-center overflow-hidden rounded-os-card bg-os-well">
        {!file.src ? (
          <p className="text-sm text-os-grey">Preview isn't available right now.</p>
        ) : file.kind === "pdf" ? (
          <iframe src={file.src} title={file.title} className="h-[28rem] w-full" />
        ) : (
          <button type="button" aria-label={`View ${file.title} larger`} onClick={() => setViewing(true)} className="w-full cursor-zoom-in">
            <img src={file.src} alt={file.title} className="max-h-[28rem] w-full object-contain" />
          </button>
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
