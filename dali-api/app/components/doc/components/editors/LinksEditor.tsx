import { Check, GripVertical, ImagePlus, Link2, Pencil, Plus, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { useToast } from "~/components/ui/toast";
import { TONES, safeHref, type ComponentData } from "../kinds";
import { IMAGE_UPLOAD_ACCEPT, uploadEditorImage } from "../../upload";

export function linkLabel(href: string): string {
  const raw = href.trim();
  if (!raw) return "";
  try {
    return new URL(/^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`).hostname.replace(/^www\./, "") || raw;
  } catch {
    return raw;
  }
}

type ResourceFields = { title: string; description: string; meta: string; href: string; image: string; tone: string };
const EMPTY_RESOURCE: ResourceFields = { title: "", description: "", meta: "", href: "", image: "", tone: "" };

function ResourceThumb({ image, tone }: { image?: string; tone?: string }) {
  const [broken, setBroken] = useState(false);
  return (
    <span className={`dali-cmp-row__thumb dali-cmp-tone--${tone || "accent"}`} aria-hidden>
      {image && !broken && <img src={image} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} />}
    </span>
  );
}

function ResourceForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial: ResourceFields;
  submitLabel: string;
  onSubmit: (fields: ResourceFields) => void;
  onCancel: () => void;
}) {
  const [f, setF] = useState(initial);
  const detailOpen = !!initial.meta;
  const [error, setError] = useState<string | null>(null);
  const [lookup, setLookup] = useState<"idle" | "loading" | "found" | "none">("idle");
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const looked = useRef(initial.href.trim());
  const imageTouched = useRef(!!initial.image);
  const set = (patch: Partial<ResourceFields>) => {
    setError(null);
    setF((c) => ({ ...c, ...patch }));
  };
  const canSubmit = f.title.trim().length > 0 && f.href.trim().length > 0 && !uploading;

  const findPreview = async () => {
    const href = safeHref(f.href);
    if (!href || href === looked.current || !/^https?:/i.test(href)) return;
    looked.current = href;
    setLookup("loading");
    try {
      const body = new FormData();
      body.set("url", href);
      const res = await fetch("/api/link-preview", { method: "POST", body });
      const data = (await res.json()) as { image: string | null; title: string | null; description: string | null };
      setF((c) => ({
        ...c,
        image: !imageTouched.current && data.image ? data.image : c.image,
        title: c.title.trim() ? c.title : (data.title ?? "").slice(0, 120),
        description: c.description.trim() ? c.description : (data.description ?? "").slice(0, 200),
      }));
      setLookup(data.image ? "found" : "none");
    } catch {
      setLookup("none");
    }
  };

  const submit = () => {
    if (!canSubmit) return;
    const href = f.href.trim();
    if (!safeHref(href)) return setError("Enter a valid link, like https://… or mailto:…");
    onSubmit({ ...f, title: f.title.trim(), description: f.description.trim(), meta: f.meta.trim(), href });
  };

  return (
    <div
      className="dali-cmp-rowform"
      role="group"
      aria-label={submitLabel === "Add resource" ? "New resource" : "Edit resource"}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          onCancel();
        } else if (e.key === "Enter" && e.target instanceof HTMLInputElement) {
          e.preventDefault();
          submit();
        }
      }}
    >
      <div className="dali-cmp-rowform__body">
      <div className="dali-cmp-rowform__fields">
      <label className="dali-cmp-pop-field">
        <span>Link</span>
        <input
          autoFocus
          value={f.href}
          placeholder="https://..."
          inputMode="url"
          aria-invalid={!!error}
          onChange={(e) => set({ href: e.target.value })}
          onBlur={() => void findPreview()}
        />
      </label>
      <label className="dali-cmp-pop-field">
        <span>Resource name</span>
        <input value={f.title} placeholder="e.g. Getting started guide" onChange={(e) => set({ title: e.target.value })} />
      </label>
      <label className="dali-cmp-pop-field">
        <span>Description <em>Optional</em></span>
        <input value={f.description} placeholder="What is this resource for?" onChange={(e) => set({ description: e.target.value })} />
      </label>
      {detailOpen && (
        <label className="dali-cmp-pop-field">
          <span>Detail <em>Optional</em></span>
          <input value={f.meta} placeholder="e.g. PDF, 12 pages" onChange={(e) => set({ meta: e.target.value })} />
        </label>
      )}
      </div>
      <div className="dali-cmp-rowform__media">
        <ResourceThumb image={f.image} tone={f.tone} />
        <div className="dali-cmp-rowform__mediactl">
          <div className="dali-cmp-rowform__mediabtns">
            <button type="button" className="dali-cmp-mini" disabled={uploading} onClick={() => fileRef.current?.click()}>
              <ImagePlus size={12} strokeWidth={1.5} aria-hidden />
              {uploading ? "Uploading" : f.image ? "Change image" : "Upload image"}
            </button>
            {f.image && (
              <button
                type="button"
                className="dali-cmp-mini"
                onClick={() => {
                  imageTouched.current = true;
                  set({ image: "" });
                }}
              >
                Remove
              </button>
            )}
            <input
              ref={fileRef}
              type="file"
              accept={IMAGE_UPLOAD_ACCEPT}
              className="hidden"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file) return;
                setUploading(true);
                try {
                  imageTouched.current = true;
                  set({ image: await uploadEditorImage(file) });
                } finally {
                  setUploading(false);
                }
              }}
            />
          </div>
          <div className="dali-cmp-chip-pop__colors" role="radiogroup" aria-label="Color">
            {TONES.map((tn) => {
              const on = (f.tone || "accent") === tn;
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
          <p className="dali-cmp-rowform__hint" aria-live="polite">
            {lookup === "loading"
              ? "Looking for an image…"
              : lookup === "found"
                ? "Image found from the link."
                : ""}
          </p>
        </div>
      </div>
      </div>
      {error && (
        <p role="alert" className="dali-cmp-pop-error">
          {error}
        </p>
      )}
      <div className="dali-cmp-rowform__actions">
        <button type="button" className="dali-cmp-mini dali-cmp-cancel" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="os-btn-primary os-btn-primary--sm" disabled={!canSubmit} onClick={submit}>
          {submitLabel}
        </button>
      </div>
    </div>
  );
}

export function LinksEditor({
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
  const [subOpen, setSubOpen] = useState(!!draft.fields.subtitle);
  const [form, setForm] = useState<number | "new" | null>(null);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragReady, setDragReady] = useState<number | null>(null);
  const toast = useToast();
  const [needLink, setNeedLink] = useState(false);
  const missingLink = draft.items.findIndex((it) => !(it.href ?? "").trim());
  const addRef = useRef<HTMLButtonElement | null>(null);
  const openRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const setField = (key: string, value: string) =>
    setDraft((d) => ({ ...d, fields: { ...d.fields, [key]: value } }));
  const closeForm = (focusIndex?: number) => {
    setForm(null);
    requestAnimationFrame(() => (focusIndex === undefined ? addRef.current : openRefs.current[focusIndex])?.focus());
  };
  const move = (from: number, to: number) => {
    if (to < 0 || to >= draft.items.length || from === to) return;
    setForm(null);
    setDraft((d) => {
      const items = [...d.items];
      const [it] = items.splice(from, 1);
      items.splice(to, 0, it!);
      return { ...d, items };
    });
  };

  return (
    <div className="dali-cmp-panel dali-cmp-panel--flush dali-cmp-links-edit">
      <div className="dali-cmp-head">
        <input
          aria-label="Section title"
          value={draft.fields.title ?? ""}
          placeholder="Title"
          onChange={(e) => setField("title", e.target.value)}
          className="dali-cmp-title dali-cmp-bare"
        />
        {subOpen ? (
          <input
            aria-label="Subtitle"
            value={draft.fields.subtitle ?? ""}
            placeholder="Subtitle"
            autoFocus={!draft.fields.subtitle}
            onChange={(e) => setField("subtitle", e.target.value)}
            className="dali-cmp-sub dali-cmp-bare"
          />
        ) : (
          <button type="button" className="dali-cmp-mini dali-cmp-mini--flush self-start" onClick={() => setSubOpen(true)}>
            Add subtitle
          </button>
        )}
      </div>

      {draft.items.map((it, i) =>
        form === i ? (
          <ResourceForm
            key={i}
            initial={{ title: it.title ?? "", description: it.description ?? "", meta: it.meta ?? "", href: it.href ?? "", image: it.image ?? "", tone: it.tone ?? "" }}
            submitLabel="Save"
            onCancel={() => closeForm(i)}
            onSubmit={(f) => {
              setDraft((d) => ({ ...d, items: d.items.map((x, j) => (j === i ? { ...x, ...f } : x)) }));
              closeForm(i);
            }}
          />
        ) : (
          <div
            key={i}
            draggable={dragReady === i}
            className={`dali-cmp-row dali-cmp-row--edit${dragFrom === i ? " dali-cmp-row--dragging" : ""}`}
            onKeyDown={(e) => {
              if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
                e.preventDefault();
                const to = i + (e.key === "ArrowUp" ? -1 : 1);
                move(i, to);
                requestAnimationFrame(() => openRefs.current[to]?.focus());
              }
            }}
            onDragStart={(e) => {
              e.dataTransfer.setData("text/plain", String(i));
              setDragFrom(i);
            }}
            onDragOver={(e) => {
              if (dragFrom === null) return;
              e.preventDefault();
              if (dragFrom !== i) {
                move(dragFrom, i);
                setDragFrom(i);
              }
            }}
            onDrop={(e) => {
              e.preventDefault();
              setDragFrom(null);
              setDragReady(null);
            }}
            onDragEnd={() => {
              setDragFrom(null);
              setDragReady(null);
            }}
          >
            <button
              type="button"
              className="dali-cmp-row__tool dali-cmp-row__grip"
              aria-label={`Reorder ${it.title || "resource"}. Drag, or use Alt plus the up and down arrow keys.`}
              onMouseDown={() => setDragReady(i)}
              onMouseUp={() => setDragReady(null)}
              onKeyDown={(e) => {
                if (e.key === "ArrowUp" || e.key === "ArrowDown") {
                  e.preventDefault();
                  e.stopPropagation();
                  move(i, i + (e.key === "ArrowUp" ? -1 : 1));
                }
              }}
            >
              <GripVertical size={16} strokeWidth={1.5} aria-hidden />
            </button>
            <button
              type="button"
              ref={(el) => {
                openRefs.current[i] = el;
              }}
              className="dali-cmp-row__main dali-cmp-row__open"
              aria-label={`Edit ${it.title || "resource"}`}
              onClick={() => setForm(i)}
            >
              <ResourceThumb image={it.image} tone={it.tone} />
              <span className="dali-cmp-row__text">
                <span className="dali-cmp-row__title">{it.title || "Untitled resource"}</span>
                {it.description && <span className="dali-cmp-sub">{it.description}</span>}
                {it.href ? (
                  <span className="dali-cmp-row__linkind">
                    <Link2 size={12} strokeWidth={1.5} aria-hidden />
                    {linkLabel(it.href)}
                  </span>
                ) : (
                  <span className="dali-cmp-row__linkind dali-cmp-row__linkind--missing">Link required</span>
                )}
              </span>
            </button>
            <div className="dali-cmp-row__tools">
              <button type="button" className="dali-cmp-row__tool" aria-label={`Edit ${it.title || "resource"}`} title="Edit" onClick={() => setForm(i)}>
                <Pencil size={16} strokeWidth={1.5} aria-hidden />
              </button>
              <button
                type="button"
                className="dali-cmp-row__tool dali-cmp-row__tool--del"
                aria-label={`Delete ${it.title || "resource"}`}
                title="Delete"
                onClick={() => {
                  setForm(null);
                  setDraft((d) => ({ ...d, items: d.items.filter((_, j) => j !== i) }));
                  toast.error(<span className="font-medium text-destructive">Resource deleted</span>, {
                    duration: 8000,
                    actions: [
                      {
                        label: "Undo",
                        onClick: () =>
                          setDraft((d) => {
                            const items = [...d.items];
                            items.splice(Math.min(i, items.length), 0, it);
                            return { ...d, items };
                          }),
                      },
                    ],
                  });
                }}
              >
                <Trash2 size={16} strokeWidth={1.5} aria-hidden />
              </button>
            </div>
          </div>
        ),
      )}

      {form === "new" && (
        <ResourceForm
          initial={EMPTY_RESOURCE}
          submitLabel="Add resource"
          onCancel={() => closeForm()}
          onSubmit={(f) => {
            setDraft((d) => ({ ...d, items: [...d.items, f] }));
            closeForm();
          }}
        />
      )}

      {form === null && (
        <button ref={addRef} type="button" className="dali-cmp-row dali-cmp-row--add" onClick={() => setForm("new")}>
          <Plus size={12} strokeWidth={1.5} aria-hidden />
          Add resource
        </button>
      )}

      <div className="dali-cmp-foot" aria-live="polite">
        {needLink && missingLink >= 0 && (
          <span role="alert" className="dali-cmp-pop-error">
            Every resource needs a link.
          </span>
        )}
        <button type="button" className="dali-cmp-mini dali-cmp-cancel" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="os-btn-primary os-btn-primary--sm dali-cmp-done"
          onClick={() => {
            if (missingLink >= 0) {
              setNeedLink(true);
              setForm(missingLink);
              return;
            }
            onSave(draft);
          }}
        >
          Done
        </button>
      </div>
    </div>
  );
}

