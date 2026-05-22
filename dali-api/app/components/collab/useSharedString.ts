import { useCallback, useEffect, useRef, useState } from "react";
import * as Y from "yjs";
import { HocuspocusProvider } from "@hocuspocus/provider";
import { getCollabUrl } from "./util";

/**
 * Live-synced single string value backed by a Hocuspocus-persisted Y.Map.
 *
 * Use for small joint fields (dropdowns, single-select choices) where a full
 * collaborative text editor is overkill. The Y.Map is persisted via the
 * existing CollabDocument storage path, so the value survives reconnects.
 *
 * Sync model: on first connection, if the Y.Map is empty, the local
 * `initialValue` is written into it so latecomers see something. Once any
 * client writes, that value wins for everyone. `initialValue` is only read at
 * bootstrap — later changes to it are ignored to avoid clobbering live edits.
 */
export function useSharedString(
  documentName: string,
  token: string | null | undefined,
  initialValue: string,
): {
  value: string;
  setValue: (next: string) => void;
  synced: boolean;
} {
  const [value, setLocalValue] = useState(initialValue);
  const [synced, setSynced] = useState(false);
  const ymapRef = useRef<Y.Map<string> | null>(null);
  const initialRef = useRef(initialValue);
  initialRef.current = initialValue;

  useEffect(() => {
    if (!token) return;
    const ydoc = new Y.Doc();
    const provider = new HocuspocusProvider({
      url: getCollabUrl(),
      name: documentName,
      document: ydoc,
      token,
    });
    const ymap = ydoc.getMap<string>("shared");
    ymapRef.current = ymap;

    const handleSynced = () => {
      const cur = ymap.get("value");
      if (cur !== undefined) {
        setLocalValue(cur);
      } else if (initialRef.current) {
        ymap.set("value", initialRef.current);
      }
      setSynced(true);
    };

    const handleChange = () => {
      const cur = ymap.get("value");
      setLocalValue(cur ?? "");
    };

    provider.on("synced", handleSynced);
    ymap.observe(handleChange);

    return () => {
      provider.off("synced", handleSynced);
      ymap.unobserve(handleChange);
      ymapRef.current = null;
      provider.destroy();
      ydoc.destroy();
    };
  }, [documentName, token]);

  const setValue = useCallback((next: string) => {
    setLocalValue(next);
    ymapRef.current?.set("value", next);
  }, []);

  return { value, setValue, synced };
}
