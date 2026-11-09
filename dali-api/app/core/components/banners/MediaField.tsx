import { useEffect, useState, type ChangeEvent } from "react";
import { Upload, X } from "lucide-react";
import { IconButton } from "~/components/ui/IconButton";
import { useToast } from "~/components/ui/toast";
import { useOsChrome } from "~/components/os-chrome";
import { PhotoCropModal } from "~/components/PhotoCropModal";
import { uploadFileToS3 } from "~/lib/upload-client";
import { rawUploadUrl } from "~/components/doc/upload";
import { cn } from "~/lib/cn";
import { BANNER_UPLOAD_PREFIX } from "~/core/lib/banners";

const CROP_OUTPUT_SHORT_SIDE = 1080;

export function MediaField({
  label,
  accept,
  value,
  onChange,
  cropAspect,
}: {
  label: string;
  accept: string;
  value: string | null;
  onChange: (url: string | null) => void;
  cropAspect?: number;
}) {
  const os = useOsChrome();
  const toast = useToast();
  const [uploading, setUploading] = useState(false);
  const [crop, setCrop] = useState<{ src: string; name: string } | null>(null);
  const isUpload = value?.startsWith("/api/upload/raw") ?? false;

  useEffect(() => () => {
    if (crop) URL.revokeObjectURL(crop.src);
  }, [crop]);

  const upload = async (file: File) => {
    setUploading(true);
    try {
      const meta = await uploadFileToS3(file, BANNER_UPLOAD_PREFIX, accept);
      onChange(rawUploadUrl(meta.s3Key));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    // Cropping a GIF would freeze it on one frame.
    if (cropAspect && file.type.startsWith("image/") && file.type !== "image/gif") {
      setCrop({ src: URL.createObjectURL(file), name: file.name.replace(/\.[^.]+$/, "") || "image" });
    } else {
      void upload(file);
    }
  };

  const onCropped = (blob: Blob) => {
    const name = `${crop?.name ?? "image"}.${blob.type.split("/")[1] ?? "png"}`;
    setCrop(null);
    void upload(new File([blob], name, { type: blob.type }));
  };

  return (
    <div className={os.fieldLabel}>
      {label}
      <div className="flex items-center gap-2">
        <input
          className="min-w-0 flex-1"
          value={isUpload ? "Uploaded file" : (value ?? "")}
          readOnly={isUpload}
          onChange={(e) => onChange(e.target.value || null)}
          placeholder="https://"
        />
        {value ? (
          <IconButton label="Remove" icon={X} onClick={() => onChange(null)} />
        ) : (
          <label className={cn(os.actionBtn(), "cursor-pointer", uploading && "pointer-events-none opacity-50")}>
            <Upload className={os.actionIcon} /> {uploading ? "Uploading…" : "Upload"}
            <input type="file" accept={accept} className="sr-only" onChange={onFile} />
          </label>
        )}
      </div>
      {cropAspect && (
        <PhotoCropModal
          open={crop !== null}
          imageSrc={crop?.src ?? null}
          aspect={cropAspect}
          cropShape="rect"
          title="Crop to fit"
          outputShortSide={CROP_OUTPUT_SHORT_SIDE}
          fit
          onCancel={() => setCrop(null)}
          onConfirm={onCropped}
        />
      )}
    </div>
  );
}
