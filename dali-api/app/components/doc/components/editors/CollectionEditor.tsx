import { GripVertical, Plus, Trash2, X, ChevronDown } from "lucide-react";
import { useRef, useState } from "react";
import { useToast } from "~/components/ui/toast";
import { safeHref, collectionCategories, type ComponentData } from "../kinds";
import { COLLECTION_ICONS, CollectionTileBody } from "../CollectionView";

type CollectionFields = { title: string; description: string; category: string; icon: string; href: string };
const EMPTY_TILE: CollectionFields = { title: "", description: "", category: "", icon: "link", href: "" };

function CollectionForm({
  initial,
  categories,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial: CollectionFields;
  categories: string[];
  submitLabel: string;
  onSubmit: (fields: CollectionFields) => void;
  onCancel: () => void;
}) {
  const [f, setF] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const looked = useRef(initial.href.trim());
  const set = (patch: Partial<CollectionFields>) => {
    setError(null);
    setF((c) => ({ ...c, ...patch }));
  };
  const canSubmit = f.title.trim().length > 0 && f.href.trim().length > 0;

  const findPreview = async () => {
    const href = safeHref(f.href);
    if (!href || href === looked.current || !/^https?:/i.test(href)) return;
    looked.current = href;
    try {
      const body = new FormData();
      body.set("url", href);
      const res = await fetch("/api/link-preview", { method: "POST", body });
      const data = (await res.json()) as { title: string | null; description: string | null };
      setF((c) => ({
        ...c,
        title: c.title.trim() ? c.title : (data.title ?? "").slice(0, 120),
        description: c.description.trim() ? c.description : (data.description ?? "").slice(0, 140),
      }));
    } catch {
      /* the link still works without a preview */
    }
  };
  const submit = () => {
    if (!canSubmit) return;
    const href = f.href.trim();
    if (!safeHref(href)) return setError("Enter a valid link, like https://… or a path starting with /");
    onSubmit({ ...f, title: f.title.trim(), description: f.description.trim(), category: f.category.replace(/,/g, " ").trim(), href });
  };

  return (
    <div
      className="dali-cmp-rowform dali-cmp-coll__form"
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
      <label className="dali-cmp-pop-field">
        <span>Link</span>
        <input autoFocus value={f.href} placeholder="https://..." inputMode="url" aria-invalid={!!error} onChange={(e) => set({ href: e.target.value })} onBlur={() => void findPreview()} />
      </label>
      <label className="dali-cmp-pop-field">
        <span>Resource name</span>
        <input value={f.title} placeholder="e.g. Figma" onChange={(e) => set({ title: e.target.value })} />
      </label>
      <label className="dali-cmp-pop-field">
        <span>Description <em>Optional</em></span>
        <input value={f.description} placeholder="What is this for?" onChange={(e) => set({ description: e.target.value })} />
      </label>
      <label className="dali-cmp-pop-field">
        <span>Category <em>Optional</em></span>
        <input value={f.category} list="dali-coll-cats" placeholder="Pick or type a new one" onChange={(e) => set({ category: e.target.value })} />
        <datalist id="dali-coll-cats">
          {categories.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
      </label>
      <div className="dali-cmp-pop-field">
        <span>Icon</span>
        <div className="dali-cmp-coll__icons" role="radiogroup" aria-label="Icon">
          {Object.entries(COLLECTION_ICONS).map(([id, { label, Icon }]) => (
            <button key={id} type="button" role="radio" aria-checked={f.icon === id} aria-label={label} title={label} onClick={() => set({ icon: id })} className="dali-cmp-coll__iconbtn">
              <Icon size={16} strokeWidth={1.75} aria-hidden />
            </button>
          ))}
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

export function CollectionEditor({
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
  const [form, setForm] = useState<number | "new" | null>(null);
  const [expanded, setExpanded] = useState(true);
  const [newCat, setNewCat] = useState("");
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragReady, setDragReady] = useState<number | null>(null);
  const toast = useToast();
  const categories = collectionCategories(draft.fields, draft.items);
  const startsOpen = draft.fields.open !== "0";
  const setField = (patch: Record<string, string>) => setDraft((d) => ({ ...d, fields: { ...d.fields, ...patch } }));
  const setCategories = (list: string[]) => setField({ categories: list.join(", ") });
  const addCategory = () => {
    const v = newCat.replace(/,/g, " ").trim();
    if (v && !categories.some((c) => c.toLowerCase() === v.toLowerCase())) setCategories([...categories, v]);
    setNewCat("");
  };
  const removeCategory = (c: string) => {
    setCategories(categories.filter((x) => x !== c));
    setDraft((d) => ({ ...d, items: d.items.map((it) => ((it.category ?? "").toLowerCase() === c.toLowerCase() ? { ...it, category: "" } : it)) }));
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
  const withCategory = (category: string) => {
    if (category && !categories.some((c) => c.toLowerCase() === category.toLowerCase())) setCategories([...categories, category]);
  };

  return (
    <div className="dali-cmp-coll dali-cmp-coll--edit dali-cmp-coll--open">
      <div className="dali-cmp-coll__headedit">
        <input aria-label="Section title" value={draft.fields.title ?? ""} placeholder="Title" onChange={(e) => setField({ title: e.target.value })} className="dali-cmp-title dali-cmp-bare" />
        <button type="button" className="dali-cmp-coll__chevbtn" aria-expanded={expanded} aria-label={expanded ? "Preview collapsed" : "Preview expanded"} title={expanded ? "Preview collapsed" : "Preview expanded"} onClick={() => setExpanded((x) => !x)}>
          <ChevronDown className="dali-cmp-coll__chev" size={18} strokeWidth={1.75} aria-hidden />
        </button>
      </div>
      <div className="dali-cmp-foot">
        <button type="button" className="dali-cmp-mini dali-cmp-cancel" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="os-btn-primary os-btn-primary--sm dali-cmp-done" onClick={() => onSave(draft)}>
          Done
        </button>
      </div>

      <div className="dali-cmp-coll__meta">
        <div className="dali-cmp-coll__filters" role="group" aria-label="Categories">
          {categories.map((c) => (
            <span key={c} className="dali-cmp-coll__chip dali-cmp-coll__chip--edit">
              {c}
              <button type="button" aria-label={`Remove category ${c}`} title="Remove category" onClick={() => removeCategory(c)}>
                <X size={11} strokeWidth={2} aria-hidden />
              </button>
            </span>
          ))}
          <input
            aria-label="New category"
            value={newCat}
            placeholder="+ Category"
            onChange={(e) => setNewCat(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addCategory();
              }
            }}
            onBlur={addCategory}
            className="dali-cmp-coll__newcat"
          />
        </div>
        <button type="button" role="switch" aria-checked={!startsOpen} className="dali-cmp-mini dali-cmp-coll__switch" onClick={() => setField({ open: startsOpen ? "0" : "1" })}>
          {startsOpen ? "Starts open" : "Starts collapsed"}
        </button>
      </div>

      <div className={`dali-cmp-coll__body${expanded ? "" : " dali-cmp-coll__body--shut"}`} inert={!expanded}>
        <div className="dali-cmp-coll__inner">
          <div className="dali-cmp-coll__grid">
            {draft.items.map((it, i) =>
              form === i ? (
                <CollectionForm
                  key={i}
                  initial={{ title: it.title ?? "", description: it.description ?? "", category: it.category ?? "", icon: it.icon || "link", href: it.href ?? "" }}
                  categories={categories}
                  submitLabel="Save"
                  onCancel={() => setForm(null)}
                  onSubmit={(f) => {
                    withCategory(f.category);
                    setDraft((d) => ({ ...d, items: d.items.map((x, j) => (j === i ? { ...x, ...f } : x)) }));
                    setForm(null);
                  }}
                />
              ) : (
                <div
                  key={i}
                  draggable={dragReady === i}
                  className={`dali-cmp-coll__tile dali-cmp-coll__tile--edit${dragFrom === i ? " dali-cmp-coll__tile--dragging" : ""}`}
                  onKeyDown={(e) => {
                    if (e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
                      e.preventDefault();
                      move(i, i + (e.key === "ArrowLeft" ? -1 : 1));
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
                  <button type="button" className="dali-cmp-row__tool dali-cmp-coll__grip" aria-label={`Reorder ${it.title || "resource"}. Drag, or use Alt plus the left and right arrow keys.`} onMouseDown={() => setDragReady(i)} onMouseUp={() => setDragReady(null)} onKeyDown={(e) => {
                    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
                      e.preventDefault();
                      e.stopPropagation();
                      move(i, i + (e.key === "ArrowLeft" ? -1 : 1));
                    }
                  }}>
                    <GripVertical size={14} strokeWidth={1.5} aria-hidden />
                  </button>
                  <button type="button" className="dali-cmp-coll__open" aria-label={`Edit ${it.title || "resource"}`} onClick={() => setForm(i)}>
                    <CollectionTileBody item={it} categories={categories} />
                  </button>
                  <div className="dali-cmp-coll__tools">
                    <button type="button" className="dali-cmp-row__tool dali-cmp-row__tool--del" aria-label={`Delete ${it.title || "resource"}`} title="Delete" onClick={() => {
                      setForm(null);
                      setDraft((d) => ({ ...d, items: d.items.filter((_, j) => j !== i) }));
                      toast.error(<span className="font-medium text-destructive">Resource deleted</span>, {
                        duration: 8000,
                        actions: [{ label: "Undo", onClick: () => setDraft((d) => { const items = [...d.items]; items.splice(Math.min(i, items.length), 0, it); return { ...d, items }; }) }],
                      });
                    }}>
                      <Trash2 size={14} strokeWidth={1.5} aria-hidden />
                    </button>
                  </div>
                </div>
              ),
            )}
            {form === "new" ? (
              <CollectionForm
                initial={EMPTY_TILE}
                categories={categories}
                submitLabel="Add resource"
                onCancel={() => setForm(null)}
                onSubmit={(f) => {
                  withCategory(f.category);
                  setDraft((d) => ({ ...d, items: [...d.items, f] }));
                  setForm(null);
                }}
              />
            ) : form === null ? (
              <button type="button" className="dali-cmp-coll__tile dali-cmp-coll__tile--add" onClick={() => setForm("new")}>
                <Plus size={14} strokeWidth={1.5} aria-hidden />
                Add resource
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

