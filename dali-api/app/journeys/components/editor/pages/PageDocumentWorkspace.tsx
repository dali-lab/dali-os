import { useState } from "react";
import { FileText, Plus } from "lucide-react";
import { DocEditor } from "~/components/doc";
import { buttonClasses } from "~/components/ui/Button";
import { LESSON_FEATURES } from "~/journeys/lib/doc-features";
import { createPage, moveItem } from "~/journeys/lib/journey-edit";
import type { LessonPage, RichDoc } from "~/journeys/lib/types";
import { PageListItem } from "./PageListItem";

export function PageDocumentWorkspace({
  pages,
  initialPageId,
  onChangePages,
  onDeletePage,
}: {
  pages: LessonPage[];
  initialPageId: string | null;
  onChangePages: (fn: (pages: LessonPage[]) => LessonPage[]) => void;
  onDeletePage: (page: LessonPage) => Promise<boolean>;
}) {
  const [activeId, setActiveId] = useState<string | null>(initialPageId ?? pages[0]?.id ?? null);
  const page = pages.find((p) => p.id === activeId) ?? null;

  const updatePage = (id: string, patch: Partial<LessonPage>) =>
    onChangePages((ps) => ps.map((p) => (p.id === id ? { ...p, ...patch } : p)));

  const addPage = () => {
    const p = createPage();
    onChangePages((ps) => [...ps, p]);
    setActiveId(p.id);
  };

  const deletePage = async (target: LessonPage) => {
    if (!(await onDeletePage(target))) return;
    const remaining = pages.filter((p) => p.id !== target.id);
    if (target.id === activeId) setActiveId(remaining[0]?.id ?? null);
  };

  return (
    <div className="flex h-full">
      <aside aria-label="Pages" className="hidden w-72 shrink-0 flex-col border-r border-os-container md:flex">
        <div className="flex h-12 shrink-0 items-center justify-between pl-5 pr-3">
          <h3 className="text-xs font-medium text-os-grey">Pages, in reading order</h3>
          <button type="button" onClick={addPage} className={buttonClasses("ghost", "xs")}>
            <Plus className="h-3.5 w-3.5" aria-hidden />
            Add
          </button>
        </div>
        <ol className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-4">
          {pages.map((p, i) => (
            <PageListItem
              key={p.id}
              page={p}
              index={i}
              total={pages.length}
              active={p.id === activeId}
              onSelect={() => setActiveId(p.id)}
              onMove={(delta) => onChangePages((ps) => moveItem(ps, i, delta))}
              onDelete={() => deletePage(p)}
            />
          ))}
        </ol>
      </aside>

      <div className="min-w-0 flex-1 overflow-y-auto">
        {page ? (
          <div className="max-w-3xl px-6 pb-24 pt-10 lg:px-12">
            <input
              type="text"
              aria-label="Page title"
              value={page.title}
              placeholder="Page title"
              onChange={(e) => updatePage(page.id, { title: e.target.value })}
              className="mb-6 w-full bg-transparent font-heading text-4xl font-semibold text-foreground outline-none placeholder:text-os-muted"
            />
            <DocEditor
              key={page.id}
              features={LESSON_FEATURES}
              aiEnabled
              placeholder="Write the lesson, or type / for blocks like video, images and code"
              initialContent={page.content}
              onChange={(blocks) => updatePage(page.id, { content: blocks as RichDoc })}
            />
          </div>
        ) : (
          <div className="grid h-full place-items-center p-6 text-center">
            <div>
              <FileText className="mx-auto h-8 w-8 text-os-muted" aria-hidden />
              <p className="mt-3 text-os-grey">This module has no pages yet.</p>
              <button type="button" onClick={addPage} className={buttonClasses("primary", "md", "mt-5")}>
                <Plus className="h-4 w-4" aria-hidden />
                Add the first page
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
