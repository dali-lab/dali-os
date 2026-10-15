import { NotebookRail, type NotebookView } from "~/components/notebooks/NotebookRail";
import { useOsChrome } from "~/components/os-chrome";

export function EmptyNotebook({ notebook }: { notebook: NotebookView }) {
  const { card } = useOsChrome();
  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
      <NotebookRail notebook={notebook} currentId={notebook.id} />
      <div className={`${card} flex min-w-0 flex-1 items-center justify-center p-10`}>
        <p className="text-sm text-muted-foreground">No notes yet. Add one from the menu.</p>
      </div>
    </div>
  );
}
