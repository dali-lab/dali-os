import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import QRCode from "qrcode";
import { Modal, ModalHeader } from "~/components/Modal";
import { modalCardClass } from "~/components/os-chrome";
import { buttonClasses } from "~/components/ui/Button";

export function qrFileNameFor(formName: string) {
  return `${formName.trim().replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "form"}-qr.png`;
}

export function FormQrDialog({
  open,
  onClose,
  fillUrl,
  formName,
}: {
  open: boolean;
  onClose: () => void;
  fillUrl: string;
  formName: string;
}) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    QRCode.toDataURL(fillUrl, { margin: 2, width: 1024 })
      .then((url) => {
        if (!cancelled) setDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setDataUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [open, fillUrl]);

  return (
    <Modal open={open} onClose={onClose} labelledBy="form-qr-title" containerClassName={modalCardClass("max-w-sm")}>
      <ModalHeader titleId="form-qr-title" title="QR code" onClose={onClose} />
      <div className="flex flex-col gap-4">
        <div className="flex justify-center rounded-os-item bg-os-well p-5">
          <div className="rounded-xl bg-white p-2 shadow-sm">
            {dataUrl ? (
              <img src={dataUrl} alt="QR code for the form link" className="block h-40 w-40" />
            ) : (
              <div className="h-40 w-40" />
            )}
          </div>
        </div>
        <a
          href={dataUrl ?? undefined}
          download={qrFileNameFor(formName)}
          aria-disabled={!dataUrl}
          className={buttonClasses("secondary", "md", "w-full")}
        >
          <Download className="h-4 w-4" />
          Download QR code
        </a>
      </div>
    </Modal>
  );
}
