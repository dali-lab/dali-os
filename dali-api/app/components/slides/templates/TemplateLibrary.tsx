import { Trash2 } from "lucide-react";
import { IconButton } from "~/components/ui/IconButton";
import { useDialog } from "~/components/ui/dialog";
import { LayoutGlyph } from "~/components/slides/collab/LayoutPicker";
import { layoutById } from "~/components/slides/deck/layouts";
import { themeById } from "~/components/slides/deck/themes";
import type { TemplateRow } from "./templates-client";

export function templateMeta(row: TemplateRow): string {
  const slides = `${row.slideCount} ${row.slideCount === 1 ? "slide" : "slides"}`;
  return `${slides} · ${row.scope === "project" ? "Project" : "Lab"}${row.kind === "Deck" ? ` · ${themeById(row.themeId).name}` : ""}`;
}

/** Saved slides and decks to start from. A deck template inserts all of its slides. */
export function TemplateLibrary({
  templates,
  loaded,
  kind,
  onPick,
  onDelete,
}: {
  templates: TemplateRow[];
  loaded: boolean;
  kind?: "Deck" | "Slide";
  onPick: (row: TemplateRow) => void;
  onDelete?: (row: TemplateRow) => void;
}) {
  const dialog = useDialog();
  const rows = kind ? templates.filter((t) => t.kind === kind) : templates;
  if (!loaded) return <p className="p-2 text-sm text-os-grey">Loading…</p>;
  if (rows.length === 0) {
    return (
      <p className="p-2 text-sm text-os-grey">
        {kind === "Deck" ? "No saved decks yet. Choose Save as template in a deck's menu." : "Nothing saved yet. Right-click a slide and choose Save to library."}
      </p>
    );
  }
  return (
    <ul className="flex max-h-72 flex-col gap-1 overflow-y-auto" aria-label="Library">
      {rows.map((row) => (
        <li key={row.id} className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onPick(row)}
            className="flex min-w-0 flex-1 items-center gap-2 rounded-lg p-1.5 text-left text-xs transition-colors hover:bg-os-hover"
          >
            <span className="w-16 shrink-0">
              <LayoutGlyph layout={layoutById(row.firstLayoutId ?? undefined)} />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-os-fg">{row.title}</span>
              <span className="block truncate text-os-grey">{templateMeta(row)}</span>
            </span>
          </button>
          {onDelete && row.canDelete && <IconButton
              label={`Delete ${row.title}`}
              icon={Trash2}
              onClick={async () => {
                const ok = await dialog.confirm({ title: `Delete "${row.title}"?`, description: "It is removed for everyone who can use it.", tone: "destructive", confirmLabel: "Delete" });
                if (ok) onDelete(row);
              }}
            />}
        </li>
      ))}
    </ul>
  );
}
