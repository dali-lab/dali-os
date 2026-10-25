import { useRef, useState } from "react";
import { Upload } from "lucide-react";
import { DocEditor, uploadEditorImage, IMAGE_UPLOAD_ACCEPT } from "~/components/doc";
import { buttonClasses } from "~/components/ui/Button";
import { useToast } from "~/components/ui/toast";
import { useOsChrome } from "~/components/os-chrome";
import type { RichDoc, Slide } from "~/components/slides/types";
import { FormField } from "~/components/ui/FormField";

export function SlideFields({ slide, onChange }: { slide: Slide; onChange: (slide: Slide) => void }) {
  const { fieldLabel } = useOsChrome();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const hasBody = slide.layout === "content" || slide.layout === "split";
  const hasImage = slide.layout === "split" || slide.layout === "image";
  const image = slide.image ?? { src: "", alt: "" };

  const upload = async (file: File) => {
    setUploading(true);
    try {
      const src = await uploadEditorImage(file);
      onChange({ ...slide, image: { ...image, src } });
    } catch {
      toast.error("The image couldn't be uploaded.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="os-form space-y-6">
      <FormField
        label={slide.layout === "image" ? "Caption (optional)" : "Title"}
        value={slide.title}
        placeholder={slide.layout === "title" ? "Welcome to DALI Dev" : "What this slide is about"}
        onChange={(title) => onChange({ ...slide, title })}
      />

      {slide.layout === "title" && (
        <FormField label="Subtitle (optional)" value={slide.subtitle ?? ""} onChange={(subtitle) => onChange({ ...slide, subtitle })} />
      )}

      {hasBody && (
        <div className={fieldLabel}>
          <span className="os-field-label">Body</span>
          <span className="text-xs text-os-muted">Keep it short. Text that doesn't fit is cut off, so check the preview.</span>
          <div className="rounded-os-item border border-os-container bg-os-well px-2 py-1">
            <DocEditor
              key={slide.id}
              features={{}}
              density="compact"
              placeholder="Add a few short points"
              initialContent={slide.body}
              onChange={(blocks) => onChange({ ...slide, body: blocks as unknown as RichDoc })}
            />
          </div>
        </div>
      )}

      {hasImage && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex items-end gap-2">
            <div className="min-w-0 flex-1">
              <FormField
                label="Image URL"
                value={image.src}
                placeholder="https://…/photo.jpg"
                onChange={(src) => onChange({ ...slide, image: { ...image, src } })}
              />
            </div>
            <button
              type="button"
              disabled={uploading}
              onClick={() => fileRef.current?.click()}
              className={buttonClasses("secondary", "md", "shrink-0")}
            >
              <Upload className="h-4 w-4" aria-hidden />
              {uploading ? "Uploading" : "Upload"}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept={IMAGE_UPLOAD_ACCEPT}
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) void upload(file);
              }}
            />
          </div>
          <FormField
            label="Alt text"
            value={image.alt}
            placeholder="What the image shows"
            onChange={(alt) => onChange({ ...slide, image: { ...image, alt } })}
          />
        </div>
      )}

      <FormField
        label="Notes (optional)"
        multiline
        rows={4}
        value={slide.notes ?? ""}
        placeholder="Extra context or narration for this slide"
        hint="Shown under the slide for learners going through it on their own."
        onChange={(notes) => onChange({ ...slide, notes: notes || undefined })}
      />
    </div>
  );
}
