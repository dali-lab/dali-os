import { useCallback, useState } from "react";
import { useRevalidator } from "react-router";
import { useDialog } from "~/components/ui/dialog";
import { useToast } from "~/components/ui/toast";
import { seriesDefaultDiffers, setSeriesNotebookRequest, type SeriesScope } from "~/calendar/lib/series-notebook";

type Notebook = { id: string; title: string };

/** Changing a meeting series' default notebook, with the confirms around it. */
export function useSeriesNotebook() {
  const dialog = useDialog();
  const toast = useToast();
  const revalidator = useRevalidator();
  const [override, setOverride] = useState<{ meetingId: string; notebook: Notebook | null } | null>(null);

  const apply = useCallback(
    async (
      meetingId: string,
      notebookId: string | null,
      scope: SeriesScope,
      shown?: { notebook: Notebook | null },
    ) => {
      if (shown) setOverride({ meetingId, notebook: shown.notebook });
      try {
        const res = await setSeriesNotebookRequest(meetingId, notebookId, scope);
        if (!res.ok) {
          toast.error(res.error ?? "Couldn't change the notebook");
          return false;
        }
        if (res.skipped > 0) {
          toast.error(`${res.skipped} ${res.skipped === 1 ? "note" : "notes"} you can't edit stayed where they were`);
        } else {
          toast.success(notebookId ? "Notebook updated" : "Notebook cleared");
        }
        await revalidator.revalidate();
        return true;
      } finally {
        setOverride(null);
      }
    },
    [toast, revalidator],
  );

  /** After a note is filed into a notebook other than the series' default. */
  const offerFutureFiling = useCallback(
    async (meetingId: string, filed: { notebookId: string | null; seriesNotebookId: string | null }) => {
      if (!seriesDefaultDiffers(filed.notebookId, filed.seriesNotebookId)) return;
      const yes = await dialog.confirm({
        title: "Also file future meetings here?",
        description: "This meeting's later notes will go to this notebook instead of the one it uses now.",
        confirmLabel: "File future meetings here",
        cancelLabel: "Just this one",
      });
      if (yes) await apply(meetingId, filed.notebookId, "future");
    },
    [dialog, apply],
  );

  /** A new default picked by hand: ask whether notes already taken move too. */
  const changeNotebook = useCallback(
    async (meetingId: string, notebook: { id: string; title: string }, { recurring }: { recurring: boolean }) => {
      if (!recurring) {
        const yes = await dialog.confirm({
          title: `Move this note to ${notebook.title}?`,
          description: "Its notes move into that notebook.",
          confirmLabel: "Move",
        });
        if (yes) await apply(meetingId, notebook.id, "all", { notebook });
        return;
      }
      const scope = await dialog.choice({
        title: "Change this meeting's notebook",
        description: "Choose which notes go to the new notebook.",
        options: [
          { value: "future", label: "Future meetings only", description: "Notes already taken stay where they are." },
          { value: "all", label: "All meetings", description: "Move the notes already taken into it as well." },
        ],
      });
      if (scope === "future" || scope === "all") await apply(meetingId, notebook.id, scope, { notebook });
    },
    [dialog, apply],
  );

  const unsetNotebook = useCallback(
    async (meetingId: string) => {
      const yes = await dialog.confirm({
        title: "Stop filing this meeting in a notebook?",
        description: "Notes already taken stay in it. Later meetings file by their usual rules.",
        confirmLabel: "Unset",
      });
      if (yes) await apply(meetingId, null, "future", { notebook: null });
    },
    [dialog, apply],
  );

  /** The notebook to draw for a meeting: the one just picked or cleared while
   *  the change is still going out, else what the loader has. */
  const shownNotebook = useCallback(
    (meetingId: string, loaded: Notebook | null) => (override?.meetingId === meetingId ? override.notebook : loaded),
    [override],
  );

  return { apply, offerFutureFiling, changeNotebook, unsetNotebook, shownNotebook };
}
