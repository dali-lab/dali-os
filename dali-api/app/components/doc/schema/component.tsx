// The `component` block (React spec over the shared componentConfig): one node
// type for the whole component library — see ../components/kinds.ts. The block
// renders its kind's view; in an editable editor it adds an Edit button that
// opens one generic form built from the kind's field definitions.

import { createReactBlockSpec } from "@blocknote/react";
import { ArrowDown, ArrowUp, ImagePlus, Pencil, Plus, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Modal } from "~/components/Modal";
import { modalCardClass } from "~/components/os-chrome";
import { IconButton } from "~/components/ui/IconButton";
import {
  TONES,
  kindDef,
  parseComponentData,
  type ComponentData,
  type FieldDef,
  type KindDef,
} from "../components/kinds";
import { ComponentView } from "../components/views";
import { IMAGE_UPLOAD_ACCEPT, uploadEditorImage } from "../upload";
import { componentConfig } from "./configs";

function Field({
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

function ComponentForm({
  def,
  initial,
  onSave,
  onClose,
}: {
  def: KindDef;
  initial: ComponentData;
  onSave: (data: ComponentData) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  const itemFields = def.itemFields ?? [];

  const setItems = (items: ComponentData["items"]) => setDraft((d) => ({ ...d, items }));
  const move = (from: number, by: -1 | 1) => {
    const items = [...draft.items];
    const [it] = items.splice(from, 1);
    items.splice(from + by, 0, it!);
    setItems(items);
  };

  return (
    <Modal
      open
      onClose={onClose}
      labelledBy="dali-cmp-form-title"
      containerClassName={modalCardClass(def.kind === "code" ? "max-w-3xl" : "max-w-2xl")}
    >
      <form
        className="os-form flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          onSave(draft);
        }}
      >
        <h2 id="dali-cmp-form-title" className="font-heading text-lg font-bold text-foreground">
          {def.title}
        </h2>
        {def.fields.map((f) => (
          <Field
            key={f.key}
            def={f}
            value={draft.fields[f.key] ?? ""}
            onChange={(v) => setDraft((d) => ({ ...d, fields: { ...d.fields, [f.key]: v } }))}
          />
        ))}
        {itemFields.length > 0 && (
          <div className="flex flex-col gap-3">
            {draft.items.map((item, i) => (
              <div key={i} className="flex flex-col gap-3 rounded-os-item bg-os-well p-3">
                <div className="flex items-center gap-1">
                  <span className="os-field-label mr-auto">
                    {def.itemLabel} {i + 1}
                  </span>
                  <IconButton label="Move up" icon={ArrowUp} disabled={i === 0} onClick={() => move(i, -1)} />
                  <IconButton
                    label="Move down"
                    icon={ArrowDown}
                    disabled={i === draft.items.length - 1}
                    onClick={() => move(i, 1)}
                  />
                  <IconButton
                    label="Remove"
                    icon={Trash2}
                    tone="destructive"
                    onClick={() => setItems(draft.items.filter((_, j) => j !== i))}
                  />
                </div>
                <div className="flex flex-wrap gap-3">
                  {itemFields.map((f) => (
                    <Field
                      key={f.key}
                      def={f}
                      value={item[f.key] ?? ""}
                      onChange={(v) =>
                        setItems(draft.items.map((it, j) => (j === i ? { ...it, [f.key]: v } : it)))
                      }
                    />
                  ))}
                </div>
              </div>
            ))}
            <button
              type="button"
              className="os-add-btn os-add-btn--sm self-start"
              onClick={() => setItems([...draft.items, {}])}
            >
              <Plus className="h-4 w-4" />
              Add {def.itemLabel?.toLowerCase()}
            </button>
          </div>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" className="os-btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="os-btn-primary os-btn-primary--sm">
            Save
          </button>
        </div>
      </form>
    </Modal>
  );
}

function ComponentBlock({
  kind,
  data,
  editable,
  onSave,
}: {
  kind: string;
  data: string;
  editable: boolean;
  onSave: (data: ComponentData) => void;
}) {
  const def = kindDef(kind);
  const parsed = parseComponentData(kind, data);
  const [editing, setEditing] = useState(false);

  if (!def) {
    return (
      <div className="dali-cmp dali-cmp--unknown" contentEditable={false}>
        Unsupported component
      </div>
    );
  }

  return (
    <div className="dali-cmp" data-component={kind} contentEditable={false}>
      <ComponentView kind={kind} data={parsed} />
      {editable && (
        <button
          type="button"
          className="dali-cmp-edit"
          aria-label={`Edit ${def.title}`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setEditing(true)}
        >
          <Pencil className="h-3.5 w-3.5" aria-hidden />
          Edit
        </button>
      )}
      {/* Portaled: the form must not live inside the editor's own DOM, where
          ProseMirror would handle its keystrokes and selection. */}
      {editing &&
        createPortal(
          <ComponentForm
            def={def}
            initial={parsed}
            onClose={() => setEditing(false)}
            onSave={(next) => {
              onSave(next);
              setEditing(false);
            }}
          />,
          document.body,
        )}
    </div>
  );
}

const createComponentBlock = createReactBlockSpec(componentConfig, {
  render: (props) => (
    <ComponentBlock
      kind={props.block.props.kind}
      data={props.block.props.data}
      editable={props.editor.isEditable}
      onSave={(next) =>
        props.editor.updateBlock(props.block, { props: { data: JSON.stringify(next) } })
      }
    />
  ),
});

export const ComponentSpec = createComponentBlock();
