// The `component` block (React spec over the shared componentConfig): one node
// type for the whole component library — see ../components/kinds.ts. The block
// renders its kind's view; in an editable editor it adds an Edit button that
// opens one generic form built from the kind's field definitions.

import { createReactBlockSpec } from "@blocknote/react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { IconButton } from "~/components/ui/IconButton";
import { kindDef, parseComponentData, type ComponentData, type KindDef } from "../components/kinds";
import { ComponentView } from "../components/views";
import { CardsEditor } from "../components/editors/CardsEditor";
import { ChipsEditor } from "../components/editors/ChipsEditor";
import { CollectionEditor } from "../components/editors/CollectionEditor";
import { FeatureEditor } from "../components/editors/FeatureEditor";
import { Field } from "../components/editors/Field";
import { GalleryEditor } from "../components/editors/GalleryEditor";
import { LinksEditor } from "../components/editors/LinksEditor";
import { StatsEditor } from "../components/editors/StatsEditor";
import { TimelineEditor } from "../components/editors/TimelineEditor";
import { startItemDrag } from "../components/editors/reorder";
import { componentConfig } from "./configs";
import { onFreshComponent, takeFreshComponent } from "./fresh-components";

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

  if (def.kind === "timeline") {
    return <TimelineEditor draft={draft} setDraft={setDraft} onSave={onSave} onClose={onClose} />;
  }
  if (def.kind === "links") {
    return <LinksEditor draft={draft} setDraft={setDraft} onSave={onSave} onClose={onClose} />;
  }
  if (def.kind === "stats") {
    return <StatsEditor draft={draft} setDraft={setDraft} onSave={onSave} onClose={onClose} />;
  }
  if (def.kind === "cards") {
    return <CardsEditor draft={draft} setDraft={setDraft} onSave={onSave} onClose={onClose} />;
  }
  if (def.kind === "gallery") {
    return <GalleryEditor draft={draft} setDraft={setDraft} onSave={onSave} onClose={onClose} />;
  }
  if (def.kind === "collection") {
    return <CollectionEditor draft={draft} setDraft={setDraft} onSave={onSave} onClose={onClose} />;
  }
  if (def.kind === "feature") {
    return <FeatureEditor draft={draft} setDraft={setDraft} onSave={onSave} onClose={onClose} />;
  }
  if (def.kind === "chips") {
    return <ChipsEditor draft={draft} setDraft={setDraft} onSave={onSave} onClose={onClose} />;
  }

  return (
      <form
        className="dali-cmp-panel dali-cmp-inline"
        onSubmit={(e) => {
          e.preventDefault();
          onSave(draft);
        }}
      >
        <span className="dali-cmp-eyebrow">{def.title}</span>
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
              <div key={i} className="flex flex-col gap-3 rounded-os-item bg-card/50 p-3">
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
          <button type="button" className="dali-cmp-mini dali-cmp-cancel" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="os-btn-primary os-btn-primary--sm dali-cmp-done">
            Done
          </button>
        </div>
      </form>
  );
}

export function ComponentBlock({
  blockId,
  kind,
  data,
  editable,
  onSave,
  onRemove,
}: {
  blockId: string;
  kind: string;
  data: string;
  editable: boolean;
  onSave: (data: ComponentData) => void;
  onRemove?: () => void;
}) {
  const def = kindDef(kind);
  const parsedData = parseComponentData(kind, data);
  const { _new: _legacy, ...savedFields } = parsedData.fields;
  const saved: ComponentData = { ...parsedData, fields: savedFields };
  const [isNew, setIsNew] = useState(false);
  const [editing, setEditing] = useState(false);
  const [live, setLive] = useState<ComponentData["items"] | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const dragIdx = useRef<number | null>(null);
  const parsed = live ? { ...saved, items: live } : saved;
  const reorderable = editable && !editing && kind === "cards";

  useEffect(() => {
    if (!editable) return;
    const open = () => {
      if (!takeFreshComponent(blockId)) return;
      setIsNew(true);
      setEditing(true);
    };
    open();
    return onFreshComponent(open);
  }, [blockId, editable]);

  // Pinned cards can be dragged in place: the order updates live under the
  // pointer and is saved when the drag ends.
  useEffect(() => {
    if (!reorderable) return;
    const cards = Array.from(wrapRef.current?.querySelectorAll<HTMLElement>(".dali-cmp-grid > *") ?? []);
    cards.forEach((c, i) => {
      c.draggable = true;
      c.classList.toggle("dali-cmp-card--dragging", dragIdx.current === i);
    });
  });
  const cardIndex = (t: EventTarget) => {
    const grid = wrapRef.current?.querySelector(".dali-cmp-grid");
    const card = (t as Element).closest?.(".dali-cmp-grid > *");
    return grid && card ? Array.from(grid.children).indexOf(card) : -1;
  };
  const dragHandlers = reorderable
    ? {
        onDragStart: (e: React.DragEvent) => {
          const i = cardIndex(e.target);
          if (i < 0) return;
          dragIdx.current = i;
          startItemDrag(e, i);
          setLive([...saved.items]);
        },
        onDragOver: (e: React.DragEvent) => {
          if (dragIdx.current === null) return;
          e.preventDefault();
          const to = cardIndex(e.target);
          const from = dragIdx.current;
          if (to < 0 || to === from) return;
          dragIdx.current = to;
          setLive((cur) => {
            const items = [...(cur ?? saved.items)];
            const [it] = items.splice(from, 1);
            items.splice(to, 0, it!);
            return items;
          });
        },
        onDrop: (e: React.DragEvent) => e.preventDefault(),
        onDragEnd: () => {
          const items = live;
          dragIdx.current = null;
          setLive(null);
          if (items && JSON.stringify(items) !== JSON.stringify(saved.items)) onSave({ ...saved, items });
        },
      }
    : {};

  if (!def) {
    return (
      <div className="dali-cmp dali-cmp--unknown" contentEditable={false}>
        Unsupported component
      </div>
    );
  }

  return (
    <div ref={wrapRef} className="dali-cmp" data-component={kind} contentEditable={false} {...dragHandlers}>
      {editing ? (
        <ComponentForm
          def={def}
          initial={parsed}
          onClose={() => {
            if (isNew) onRemove?.();
            else setEditing(false);
          }}
          onSave={(next) => {
            const { _new: _flag, ...fields } = next.fields;
            onSave({ ...next, fields });
            setIsNew(false);
            setEditing(false);
          }}
        />
      ) : (
        <>
          <ComponentView kind={kind} data={parsed} />
          {editable && (
            <button
              type="button"
              className="dali-cmp-edit"
              aria-label={`Edit ${def.title}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setEditing(true)}
            >
              Edit
            </button>
          )}
        </>
      )}
    </div>
  );
}

const createComponentBlock = createReactBlockSpec(componentConfig, {
  render: (props) => (
    <ComponentBlock
      blockId={props.block.id}
      kind={props.block.props.kind}
      data={props.block.props.data}
      editable={props.editor.isEditable}
      onSave={(next) =>
        props.editor.updateBlock(props.block, { props: { data: JSON.stringify(next) } })
      }
      onRemove={() => props.editor.removeBlocks([props.block])}
    />
  ),
});

export const ComponentSpec = createComponentBlock();
