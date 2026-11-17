import { useState } from "react";
import { Button } from "~/components/ui/Button";
import { FormField } from "~/components/ui/FormField";
import { Field } from "~/components/ui/modal-fields";
import { PersonPicker } from "~/components/ui/PersonPicker";
import { Select } from "~/components/ui/floating";
import { Modal } from "~/components/Modal";
import { modalCardClass } from "~/components/os-chrome";
import type { CardOption, CategoryOption, PersonRow } from "./types";

export function cardSaveFields(
  id: string | null,
  f: { nickname: string; last4: string; ownerId: string; holderIds: string[]; defaultCategoryId: string },
): Record<string, string> {
  return {
    ...(id ? { id } : {}),
    nickname: f.nickname.trim(),
    last4: f.last4.trim(),
    ownerId: f.ownerId,
    holderIds: JSON.stringify(f.holderIds),
    defaultCategoryId: f.defaultCategoryId,
  };
}

export function CardFormModal({
  card,
  open,
  onClose,
  staff,
  members,
  categories,
  busy,
  error,
  onSave,
}: {
  card: CardOption | null;
  open: boolean;
  onClose: () => void;
  staff: PersonRow[];
  members: PersonRow[];
  categories: CategoryOption[];
  busy: boolean;
  error: string | null;
  onSave: (fields: Record<string, string>) => void;
}) {
  const [form, setForm] = useState({
    nickname: card?.nickname ?? "",
    last4: card?.last4 ?? "",
    ownerId: card?.ownerId ?? "",
    holderIds: card?.holderIds ?? [],
    defaultCategoryId: card?.defaultCategoryId ?? "",
  });
  return (
    <Modal open={open} onClose={onClose} labelledBy="card-form-title" containerClassName={modalCardClass("max-w-lg")}>
      <h2 id="card-form-title" className="mb-4 text-lg font-semibold text-foreground">
        {card ? "Edit card" : "Add a staff card"}
      </h2>
      <div className="os-form flex flex-col gap-4">
        <FormField label="Nickname" value={form.nickname} onChange={(v) => setForm({ ...form, nickname: v })} placeholder="Programs Visa" />
        <FormField label="Last four digits" value={form.last4} onChange={(v) => setForm({ ...form, last4: v })} maxLength={4} hint="Never enter the full card number." />
        <Field label="Owner">
          <Select
            ariaLabel="Owner"
            value={form.ownerId}
            onChange={(v) => setForm({ ...form, ownerId: v })}
            placeholder="Choose a staff member"
            options={staff.map((p) => ({ value: p.id, label: p.name }))}
          />
        </Field>
        <Field label="Who can file on it">
          <PersonPicker
            mode="multi"
            ariaLabel="Card holders"
            values={form.holderIds}
            onChange={(holderIds) => setForm({ ...form, holderIds })}
            people={members.map((p) => ({ id: p.id, name: p.name }))}
            placeholder="Add members"
          />
        </Field>
        <Field label="Default category">
          <Select
            ariaLabel="Default category"
            value={form.defaultCategoryId}
            onChange={(v) => setForm({ ...form, defaultCategoryId: v })}
            options={[{ value: "", label: "None" }, ...categories.filter((c) => !c.archived).map((c) => ({ value: c.id, label: c.label }))]}
          />
        </Field>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button disabled={busy} onClick={() => onSave(cardSaveFields(card?.id ?? null, form))}>
            Save card
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export function categorySaveFields(id: string | null, f: { label: string; chartString: string; hints: string }): Record<string, string> {
  return { ...(id ? { id } : {}), label: f.label.trim(), chartString: f.chartString.trim(), hints: f.hints };
}

export function CategoryFormModal({
  category,
  open,
  onClose,
  busy,
  error,
  onSave,
}: {
  category: CategoryOption | null;
  open: boolean;
  onClose: () => void;
  busy: boolean;
  error: string | null;
  onSave: (fields: Record<string, string>) => void;
}) {
  const [form, setForm] = useState({
    label: category?.label ?? "",
    chartString: category?.chartString ?? "",
    hints: category?.hints.join(", ") ?? "",
  });
  return (
    <Modal open={open} onClose={onClose} labelledBy="category-form-title" containerClassName={modalCardClass("max-w-lg")}>
      <h2 id="category-form-title" className="mb-4 text-lg font-semibold text-foreground">
        {category ? "Edit category" : "Add a category"}
      </h2>
      <div className="os-form flex flex-col gap-4">
        <FormField label="Name" value={form.label} onChange={(v) => setForm({ ...form, label: v })} placeholder="Technigala" />
        <FormField label="Chart string" mono value={form.chartString} onChange={(v) => setForm({ ...form, chartString: v })} placeholder="20.330.161028.128512.3200" />
        <FormField label="Words that suggest it" value={form.hints} onChange={(v) => setForm({ ...form, hints: v })} hint="Separate with commas. Used to suggest this category from a receipt." />
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button disabled={busy} onClick={() => onSave(categorySaveFields(category?.id ?? null, form))}>
            Save category
          </Button>
        </div>
      </div>
    </Modal>
  );
}
