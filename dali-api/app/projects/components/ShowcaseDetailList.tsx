import { useState } from "react";
import { Form, useNavigation } from "react-router";
import { Plus, X } from "lucide-react";
import type { ShowcaseDetail } from "../lib/showcase-content";

// The public write-up editor: ordered { item, description } pairs. Each pair is
// a section dali.website renders as a headed card (The Problem, Our Solution,
// …), so this is deliberately structure-only — no rich text, no layout. Add or
// remove sections freely; the three defaults are seeded by the route when a
// project has never been curated.
//
// Values post as parallel repeated fields (detailItem / detailDescription); the
// action zips them back by index, so every row always renders exactly one of
// each and the two lists stay aligned. Same uncontrolled-rows shape as the
// card's ChipList — typing never round-trips through React.
export function ShowcaseDetailList({
  details,
  canEdit,
}: {
  details: ShowcaseDetail[];
  canEdit: boolean;
}) {
  const [rows, setRows] = useState<{ key: number; item: string; description: string }[]>(
    details.map((d, i) => ({ key: i, ...d })),
  );
  const [nextKey, setNextKey] = useState(details.length);
  const navigation = useNavigation();
  const saving =
    navigation.state !== "idle" &&
    navigation.formData?.get("intent") === "showcase-details";

  return (
    <Form method="post" className="flex flex-col gap-3">
      <input type="hidden" name="intent" value="showcase-details" />

      {rows.map((row, i) => (
        <div
          key={row.key}
          className="flex items-start gap-2 rounded-lg border border-border bg-card p-3"
        >
          <div className="flex flex-1 flex-col gap-1.5 min-w-0">
            <input
              name="detailItem"
              defaultValue={row.item}
              placeholder="Section title (e.g. The Problem)"
              disabled={!canEdit}
              aria-label="Section title"
              className="bg-transparent font-semibold text-foreground border border-transparent rounded px-1 -mx-1 hover:border-dashed hover:border-border focus:outline-none focus:border-solid focus:border-accent-coral/60 focus:bg-background transition-colors disabled:hover:border-transparent"
            />
            <textarea
              name="detailDescription"
              defaultValue={row.description}
              placeholder="What a visitor should take away from this section…"
              disabled={!canEdit}
              rows={2}
              aria-label="Section text"
              className="bg-transparent text-sm text-muted-foreground border border-transparent rounded px-1 -mx-1 hover:border-dashed hover:border-border focus:outline-none focus:border-solid focus:border-accent-coral/60 focus:bg-background transition-colors disabled:hover:border-transparent resize-y"
            />
          </div>
          {canEdit && (
            <button
              type="button"
              aria-label={`Remove ${row.item || "section"}`}
              onClick={() => setRows(rows.filter((_, j) => j !== i))}
              className="mt-1 shrink-0 opacity-50 hover:opacity-100"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      ))}

      {rows.length === 0 && (
        <p className="text-sm text-muted-foreground italic px-1">
          No sections yet — a visitor sees just the card.
        </p>
      )}

      {canEdit && (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setRows([...rows, { key: nextKey, item: "", description: "" }]);
              setNextKey(nextKey + 1);
            }}
            className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded border border-dashed border-border text-muted-foreground hover:text-foreground hover:border-solid"
          >
            <Plus className="w-3.5 h-3.5" />
            Add section
          </button>
          <button
            type="submit"
            disabled={saving}
            className="px-3 py-1.5 text-sm font-medium rounded-md bg-accent-coral text-white hover:bg-accent-coral/90 transition-colors disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save sections"}
          </button>
        </div>
      )}
    </Form>
  );
}
