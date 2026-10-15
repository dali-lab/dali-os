import { useEffect, useRef, useState } from "react";
import {
  fetchNotebookRows,
  type NotebookListContext,
  type NotebookListState,
} from "~/components/notebooks/notebook-picker";

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

type PrefetchSpace = NonNullable<NotebookListContext["space"]>;

const spaceKey = (s: PrefetchSpace) => `${s.workspaceType}:${s.workspaceId ?? ""}`;

/** Loads the empty-search list of each space once `enabled`, so a picker scoped
 *  to one of them opens with rows. Returns a lookup that is undefined for a space
 *  not loaded or whose load failed, which leaves the picker to fetch for itself. */
export function useNotebookPrefetch({
  enabled,
  spaces,
  meetingId = null,
}: {
  enabled: boolean;
  spaces: PrefetchSpace[];
  meetingId?: string | null;
}): (space: PrefetchSpace | null | undefined) => NotebookListState | undefined {
  const [lists, setLists] = useState<Record<string, NotebookListState>>({});
  const requested = useRef(new Set<string>());
  const wanted = [...new Set(spaces.map(spaceKey))].sort().join("|");

  useEffect(() => {
    if (!enabled) return;
    for (const space of spaces) {
      const key = `${meetingId ?? ""}|${spaceKey(space)}`;
      if (requested.current.has(key)) continue;
      requested.current.add(key);
      setLists((l) => ({ ...l, [spaceKey(space)]: { rows: [], status: "loading" } }));
      fetchNotebookRows("", { meetingId, space })
        .then((rows) => setLists((l) => ({ ...l, [spaceKey(space)]: { rows, status: "ready" } })))
        .catch(() => setLists((l) => ({ ...l, [spaceKey(space)]: { rows: [], status: "error" } })));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, wanted, meetingId]);

  return (space) => {
    const list = space ? lists[spaceKey(space)] : undefined;
    return list && list.status !== "error" ? list : undefined;
  };
}
