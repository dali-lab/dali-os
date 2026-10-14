import { useEffect, useState } from "react";
import { fetchNotebookRows, type NotebookListState } from "~/components/notebooks/notebook-picker";

/** The notebooks the picker offers for an empty search, loaded as soon as
 *  `enabled` so the picker has them when it opens. */
export function useNotebookList({
  enabled,
  projectId = null,
  meetingId = null,
}: {
  enabled: boolean;
  projectId?: string | null;
  meetingId?: string | null;
}): NotebookListState {
  const [list, setList] = useState<NotebookListState>({ rows: [], status: "loading" });

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setList((l) => ({ ...l, status: "loading" }));
    fetchNotebookRows("", { projectId, meetingId })
      .then((rows) => {
        if (!cancelled) setList({ rows, status: "ready" });
      })
      .catch(() => {
        if (!cancelled) setList((l) => ({ ...l, status: "error" }));
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, projectId, meetingId]);

  return list;
}
