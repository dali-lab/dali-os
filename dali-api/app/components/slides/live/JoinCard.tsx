import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { X } from "lucide-react";
import { IconButton } from "~/components/ui/IconButton";

export const joinText = (url: string) => url.replace(/^https?:\/\//, "");

/** A QR code and link in the corner of a poll slide, so the room can open the deck on a phone and vote. */
export function JoinCard({ url, onHide }: { url: string; onHide?: () => void }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(url, { margin: 1, width: 192 })
      .then((data) => !cancelled && setSrc(data))
      .catch(() => !cancelled && setSrc(null));
    return () => {
      cancelled = true;
    };
  }, [url]);
  return (
    <div
      className="absolute bottom-3 right-3 z-10 flex max-w-[60%] items-center gap-3 rounded-os-card border border-os-container bg-os-card p-2 pr-3 text-os-fg shadow-lg"
      data-testid="join-card"
    >
      <div className="h-20 w-20 shrink-0 rounded-os-item bg-white p-1">
        {src ? <img src={src} alt="QR code to open the deck" className="block h-full w-full" /> : null}
      </div>
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-sm font-semibold">Scan to vote</span>
        <span className="truncate text-xs text-os-grey" data-testid="join-url">
          {joinText(url)}
        </span>
      </div>
      {onHide && <IconButton label="Hide join code" icon={X} onClick={onHide} className="self-start" />}
    </div>
  );
}
