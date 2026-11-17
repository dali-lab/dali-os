import { useRef, useState, type DragEvent } from "react";
import { FileUp } from "lucide-react";
import { Button } from "~/components/ui/Button";
import { cn } from "~/lib/cn";
import { RECEIPT_ACCEPT } from "./receipt-upload";

export function DropZone({
  onFiles,
  onNoReceipt,
  disabled,
  error,
}: {
  onFiles: (files: File[]) => void;
  onNoReceipt: () => void;
  disabled?: boolean;
  error?: string | null;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  const take = (list: FileList | null) => {
    const files = list ? [...list] : [];
    if (files.length > 0 && !disabled) onFiles(files);
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    take(e.dataTransfer.files);
  };

  return (
    <div
      data-testid="receipt-dropzone"
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      className={cn(
        "flex flex-col items-center gap-3 rounded-os-card border-2 border-dashed px-6 py-12 text-center transition-colors",
        over ? "border-os-accent bg-os-accent/10" : "border-os-container-hi bg-os-card",
      )}
    >
      <FileUp className="h-8 w-8 text-os-grey" aria-hidden />
      <div className="flex flex-col gap-1">
        <p className="text-lg font-semibold text-foreground">Drop receipts here</p>
        <p className="text-sm text-os-grey">Photos, PDFs or screenshots. Several at once become one expense.</p>
      </div>
      <input
        ref={input}
        type="file"
        multiple
        accept={RECEIPT_ACCEPT}
        className="sr-only"
        aria-label="Choose receipt files"
        onChange={(e) => {
          take(e.target.files);
          e.target.value = "";
        }}
      />
      <div className="flex items-center gap-3">
        <Button disabled={disabled} onClick={() => input.current?.click()}>
          Choose files
        </Button>
        <button type="button" onClick={onNoReceipt} className="text-sm font-medium text-os-accent hover:underline">
          No receipt?
        </button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
