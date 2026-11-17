import { ImagePlus } from "lucide-react";
import { useRef } from "react";
import { IconButton } from "~/components/ui/IconButton";
import { TONES, type FieldDef } from "../kinds";
import { IMAGE_UPLOAD_ACCEPT, uploadEditorImage } from "../../upload";

export function Field({
  def,
  value,
  onChange,
}: {
  def: FieldDef;
  value: string;
  onChange: (value: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);

  if (def.type === "tone") {
    return (
      <div className="flex flex-col gap-1.5">
        <span className="os-field-label">{def.label}</span>
        <div className="flex gap-1.5" role="radiogroup" aria-label={def.label}>
          {TONES.map((t) => (
            <button
              key={t}
              type="button"
              role="radio"
              aria-checked={value === t}
              aria-label={t}
              onClick={() => onChange(t)}
              className={`dali-cmp-swatch dali-cmp-tone--${t}`}
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <label className="flex min-w-0 flex-1 flex-col gap-1.5">
      <span>{def.label}</span>
      {def.type === "textarea" || def.type === "code" ? (
        <textarea
          rows={def.type === "code" ? 16 : 3}
          value={value}
          placeholder={def.placeholder}
          spellCheck={def.type !== "code"}
          onChange={(e) => onChange(e.target.value)}
          className={def.type === "code" ? "font-mono text-xs" : undefined}
        />
      ) : (
        <span className="flex items-center gap-1">
          <input
            type="text"
            value={value}
            placeholder={def.type === "image" ? "Image link" : def.placeholder}
            onChange={(e) => onChange(e.target.value)}
            className="min-w-0 flex-1"
          />
          {def.type === "image" && (
            <>
              <IconButton
                label="Upload image"
                icon={ImagePlus}
                onClick={() => fileRef.current?.click()}
              />
              <input
                ref={fileRef}
                type="file"
                accept={IMAGE_UPLOAD_ACCEPT}
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) onChange(await uploadEditorImage(file));
                }}
              />
            </>
          )}
        </span>
      )}
    </label>
  );
}

