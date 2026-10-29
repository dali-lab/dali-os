import { NotebookRail, type NotebookView } from "~/components/notebooks/NotebookRail";
import { useOsChrome } from "~/components/os-chrome";

export function EmptyNotebook({ notebook }: { notebook: NotebookView }) {
  const { card } = useOsChrome();
  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
      <NotebookRail notebook={notebook} currentId={notebook.id} />
      <div className={`${card} flex min-w-0 flex-1 flex-col items-center justify-center gap-4 p-10`}>
        <NotesArt />
        <p className="text-sm text-muted-foreground">No notes yet. Add one from the menu.</p>
      </div>
    </div>
  );
}

function NotesArt() {
  return (
    <div data-empty-notebook-art className="relative h-16 w-24" aria-hidden>
      <div className="absolute left-3 top-0 h-16 w-14 rotate-6 rounded-md border border-os-container bg-os-well" />
      <div className="absolute left-5 top-0 flex h-16 w-14 -rotate-3 flex-col gap-1.5 rounded-md border border-os-container bg-os-nav p-2">
        <div className="h-1.5 w-2/3 rounded-full bg-os-container-hi" />
        <div className="h-1 w-full rounded-full bg-os-container" />
        <div className="h-1 w-5/6 rounded-full bg-os-container" />
        <div className="h-1 w-1/2 rounded-full bg-os-container" />
        <div className="mt-auto h-1 w-3 rounded-full bg-os-accent" />
      </div>
    </div>
  );
}
