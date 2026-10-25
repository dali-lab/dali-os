import { useCallback, useState } from "react";
import type { Lab, LabFiles } from "~/journeys/lib/types";
import { addFile, removePath, renamePath } from "~/journeys/lib/file-tree";
import { useFileTabs } from "./useFileTabs";
import { useLabRuntime } from "./useLabRuntime";

/** Learner-side lab state: a private copy of the starter files plus tabs and runtime. */
export function useLab(lab: Lab) {
  const [files, setFiles] = useState<LabFiles>(lab.files);
  const tabs = useFileTabs(files, lab.defaultFile);
  const runtime = useLabRuntime(files, lab.steps);
  const { open, rename } = tabs;

  const updateFile = useCallback((path: string, value: string) => setFiles((f) => ({ ...f, [path]: value })), []);

  const createFile = useCallback(
    (path: string) => {
      setFiles((f) => addFile(f, path));
      open(path);
    },
    [open],
  );

  const deletePath = useCallback((path: string) => setFiles((f) => removePath(f, path)), []);

  const movePath = useCallback(
    (from: string, to: string) => {
      setFiles((f) => renamePath(f, from, to));
      rename(from, to);
    },
    [rename],
  );

  const reset = useCallback(() => setFiles(lab.files), [lab.files]);

  return { files, tabs, runtime, updateFile, createFile, deletePath, movePath, reset };
}
