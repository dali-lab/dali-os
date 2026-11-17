import { Check, ImagePlus, Plus, Trash2, X } from "lucide-react";
import { useRef, useState } from "react";
import { useOutsideDismiss } from "~/components/ui/floating";
import { TONES, safeHref, type ComponentData } from "../kinds";
import { IMAGE_UPLOAD_ACCEPT, uploadEditorImage } from "../../upload";

export function FeatureEditor({
  draft,
  setDraft,
  onSave,
  onClose,
}: {
  draft: ComponentData;
  setDraft: React.Dispatch<React.SetStateAction<ComponentData>>;
  onSave: (data: ComponentData) => void;
  onClose: () => void;
}) {
  const f = draft.fields;
  const fileRef = useRef<HTMLInputElement>(null);
  const ctaRef = useRef<HTMLDivElement>(null);
  const [uploading, setUploading] = useState(false);
  const [popOpen, setPopOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasButton = !!(f.cta || f.href);
  const set = (patch: Record<string, string>) => {
    if ("href" in patch) setError(null);
    setDraft((d) => ({ ...d, fields: { ...d.fields, ...patch } }));
  };
  const validHref = () => {
    const href = (f.href ?? "").trim();
    if (href && !safeHref(href)) {
      setError("Enter a valid link, like https://… or mailto:…");
      return false;
    }
    return true;
  };
  const closePop = () => {
    if (validHref()) setPopOpen(false);
  };
  const done = () => {
    if (!validHref()) return setPopOpen(true);
    onSave(draft);
  };
  const pickImage = async (file?: File) => {
    if (!file) return;
    setUploading(true);
    try {
      set({ image: await uploadEditorImage(file) });
    } finally {
      setUploading(false);
    }
  };

  useOutsideDismiss(popOpen, ".dali-cmp-feature-edit__cta", closePop);

  return (
    <div
      className="dali-cmp-feature-edit"
      onKeyDown={(e) => {
        if (e.key !== "Escape") return;
        e.preventDefault();
        e.stopPropagation();
        if (popOpen) {
          setPopOpen(false);
          setError(null);
        } else onClose();
      }}
    >
      <div className="dali-cmp-foot">
        <button type="button" className="dali-cmp-mini dali-cmp-cancel" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="os-btn-primary os-btn-primary--sm dali-cmp-done" onClick={done}>
          Done
        </button>
      </div>

      <div className={`dali-cmp-feature dali-cmp-tone--${f.tone || "warning"}`}>
        <div className="dali-cmp-feature-edit__artwrap">
          {f.image ? <img className="dali-cmp-feature__art" src={f.image} alt="" /> : <span className="dali-cmp-feature__art" />}
        <div className="dali-cmp-chip-pop__colors dali-cmp-feature-edit__colors" role="radiogroup" aria-label="Color">
          {TONES.map((tn) => {
            const on = f.tone === tn;
            return (
              <button
                key={tn}
                type="button"
                role="radio"
                aria-checked={on}
                aria-label={tn}
                title={tn}
                onClick={() => set({ tone: tn })}
                className={`dali-cmp-swatch dali-cmp-swatch--pick dali-cmp-tone--${tn}`}
              >
                {on && <Check className="dali-cmp-ico dali-cmp-ico--check" size={9} strokeWidth={2.25} aria-hidden />}
              </button>
            );
          })}
        </div>
          <div className="dali-cmp-feature-edit__artbtns">
            <button type="button" disabled={uploading} aria-label={f.image ? "Change image" : "Add image"} onClick={() => fileRef.current?.click()}>
              <ImagePlus size={14} strokeWidth={1.5} aria-hidden />
              {uploading ? "Uploading" : f.image ? "Change image" : "Add image"}
            </button>
            {f.image && (
              <button type="button" aria-label="Remove image" title="Remove image" onClick={() => set({ image: "" })}>
                <X size={14} strokeWidth={1.5} aria-hidden />
              </button>
            )}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept={IMAGE_UPLOAD_ACCEPT}
            className="hidden"
            onChange={(e) => {
              void pickImage(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </div>
        <div className="dali-cmp-feature__body">
          <input
            aria-label="Eyebrow"
            value={f.eyebrow ?? ""}
            placeholder="Eyebrow"
            onChange={(e) => set({ eyebrow: e.target.value })}
            className="dali-cmp-eyebrow dali-cmp-feature-edit__field"
          />
          <input
            aria-label="Title"
            value={f.title ?? ""}
            placeholder="Title"
            onChange={(e) => set({ title: e.target.value })}
            className="dali-cmp-feature__title dali-cmp-feature-edit__field"
          />
          <textarea
            aria-label="Text"
            rows={1}
            value={f.body ?? ""}
            placeholder="Add text"
            onChange={(e) => set({ body: e.target.value })}
            className="dali-cmp-sub dali-cmp-feature-edit__field"
          />
          <div className="dali-cmp-feature-edit__cta" onMouseEnter={() => hasButton && setPopOpen(true)}>
            {hasButton ? (
              <button type="button" className="dali-cmp-cta" aria-expanded={popOpen} onClick={() => (popOpen ? closePop() : setPopOpen(true))}>
                {f.cta || "Button"}
              </button>
            ) : (
              <button
                type="button"
                className="dali-cmp-feature-edit__add"
                onClick={() => {
                  set({ cta: "Open" });
                  setPopOpen(true);
                }}
              >
                <Plus size={12} strokeWidth={1.5} aria-hidden />
                Add button
              </button>
            )}
            {popOpen && hasButton && (
              <div className="dali-cmp-feature-edit__pop" role="dialog" aria-label="Button">
                <label className="dali-cmp-pop-field">
                  <span>Button text</span>
                  <input autoFocus value={f.cta ?? ""} placeholder="Open" onChange={(e) => set({ cta: e.target.value })} />
                </label>
                <label className="dali-cmp-pop-field">
                  <span>URL</span>
                  <input
                    value={f.href ?? ""}
                    placeholder="https://..."
                    inputMode="url"
                    aria-invalid={!!error}
                    onChange={(e) => set({ href: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        closePop();
                      }
                    }}
                  />
                </label>
                {error && (
                  <p role="alert" className="dali-cmp-pop-error">
                    {error}
                  </p>
                )}
                <div className="dali-cmp-pop-actions">
                  <button
                    type="button"
                    className="dali-cmp-pop-delete"
                    onClick={() => {
                      set({ cta: "", href: "" });
                      setPopOpen(false);
                    }}
                  >
                    <Trash2 className="dali-cmp-ico" size={12} strokeWidth={1.5} aria-hidden />
                    Remove
                  </button>
                  <button type="button" className="dali-cmp-pop-save" onClick={closePop}>
                    Save
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

