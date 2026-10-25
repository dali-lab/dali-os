import { useCallback, useState } from "react";
import type { LabFiles } from "~/journeys/lib/types";
import { defaultFilePath, renamePathIn } from "~/journeys/lib/file-tree";

/** Open editor tabs over a set of files. Tabs for deleted files drop out on their own. */
export function useFileTabs(files: LabFiles, preferred?: string) {
  const [tabs, setTabs] = useState<string[]>(() => {
    const first = defaultFilePath(files, preferred);
    return first ? [first] : [];
  });
  const [active, setActive] = useState<string | null>(() => defaultFilePath(files, preferred));

  const openTabs = tabs.filter((p) => p in files);
  const activePath = active && active in files ? active : (openTabs[openTabs.length - 1] ?? null);

  const open = useCallback((path: string) => {
    setTabs((prev) => (prev.includes(path) ? prev : [...prev, path]));
    setActive(path);
  }, []);

  const close = useCallback(
    (path: string) => {
      setTabs((prev) => {
        const next = prev.filter((p) => p !== path);
        if (path === activePath) {
          const idx = prev.indexOf(path);
          setActive(next[Math.max(0, idx - 1)] ?? null);
        }
        return next;
      });
    },
    [activePath],
  );

  const rename = useCallback((from: string, to: string) => {
    setTabs((prev) => prev.map((p) => renamePathIn(p, from, to)));
    setActive((prev) => (prev ? renamePathIn(prev, from, to) : prev));
  }, []);

  return { openTabs, activePath, open, close, rename };
}

export type FileTabs = ReturnType<typeof useFileTabs>;
