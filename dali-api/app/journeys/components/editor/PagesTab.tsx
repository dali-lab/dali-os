import { useState } from "react";
import { Maximize2, PlayCircle, Plus, Trash2 } from "lucide-react";
import { buttonClasses } from "~/components/ui/Button";
import { useDialog } from "~/components/ui/dialog";
import { IconButton } from "~/components/ui/IconButton";
import { moduleTitle, richDocHas, richDocWordCount } from "~/journeys/lib/journey";
import { createPage } from "~/journeys/lib/journey-edit";
import type { JourneyModule, LessonPage } from "~/journeys/lib/types";
import { FullscreenEditor } from "./FullscreenEditor";
import { PageDocumentWorkspace } from "./pages/PageDocumentWorkspace";

export function PagesTab({
  module: mod,
  onChange,
}: {
  module: JourneyModule;
  onChange: (fn: (m: JourneyModule) => JourneyModule) => void;
}) {
  const dialog = useDialog();
  // undefined: closed. null: open with no page selected.
  const [openAt, setOpenAt] = useState<string | null | undefined>(undefined);
  const setPages = (fn: (pages: LessonPage[]) => LessonPage[]) => onChange((m) => ({ ...m, pages: fn(m.pages) }));

  const addAndOpen = () => {
    const p = createPage();
    setPages((ps) => [...ps, p]);
    setOpenAt(p.id);
  };

  const deletePage = async (page: LessonPage) => {
    const ok = await dialog.confirm({
      title: `Delete ${page.title.trim() || "this page"}?`,
      confirmLabel: "Delete page",
      tone: "destructive",
    });
    if (ok) setPages((ps) => ps.filter((p) => p.id !== page.id));
    return ok;
  };

  return (
    <div className="space-y-5">
      <button type="button" onClick={() => setOpenAt(mod.pages[0]?.id ?? null)} className={buttonClasses("primary", "md", "w-full")}>
        <Maximize2 className="h-4 w-4" aria-hidden />
        Open document editor
      </button>

      <section>
        <div className="flex items-center justify-between">
          <h4 className="os-field-label">Pages, in reading order</h4>
          <button type="button" onClick={addAndOpen} className={buttonClasses("ghost", "xs")}>
            <Plus className="h-3.5 w-3.5" aria-hidden />
            Add page
          </button>
        </div>
        {mod.pages.length === 0 ? (
          <p className="mt-2 text-sm text-os-muted">No pages yet. Learners need at least one.</p>
        ) : (
          <ol className="-mx-2 mt-2 space-y-0.5">
            {mod.pages.map((p, i) => (
              <li key={p.id} className="flex items-center gap-1 rounded-os-item pr-1 transition-colors hover:bg-os-hover">
                <button type="button" onClick={() => setOpenAt(p.id)} className="flex min-w-0 flex-1 items-center gap-3 px-2 py-2.5 text-left text-sm">
                  <span className="w-4 shrink-0 tabular-nums text-os-muted">{i + 1}</span>
                  <span className="min-w-0 flex-1">
                    <span className={p.title.trim() ? "block truncate text-foreground" : "block truncate text-os-muted"}>
                      {p.title.trim() || "Untitled page"}
                    </span>
                    <span className="block text-xs text-os-muted">{richDocWordCount(p.content)} words</span>
                  </span>
                  {richDocHas(p.content, "video") && <PlayCircle className="h-4 w-4 shrink-0 text-os-muted" aria-label="Has video" />}
                </button>
                <IconButton label="Delete page" icon={Trash2} tone="destructive" onClick={() => deletePage(p)} />
              </li>
            ))}
          </ol>
        )}
      </section>

      <FullscreenEditor
        open={openAt !== undefined}
        title={`${moduleTitle(mod)} · Pages`}
        subtitle="Changes save to your draft as you type"
        onClose={() => setOpenAt(undefined)}
      >
        <PageDocumentWorkspace
          pages={mod.pages}
          initialPageId={openAt ?? null}
          onChangePages={setPages}
          onDeletePage={deletePage}
        />
      </FullscreenEditor>
    </div>
  );
}
