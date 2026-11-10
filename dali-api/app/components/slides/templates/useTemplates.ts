import { useCallback, useEffect, useState } from "react";
import { fetchTemplates, type TemplateList } from "./templates-client";

const EMPTY: TemplateList = { templates: [], canSaveToProject: false };

export function useTemplates(pageId: string, enabled = true) {
  const [list, setList] = useState<TemplateList>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const refresh = useCallback(async () => {
    const next = await fetchTemplates(pageId);
    if (next) setList(next);
    setLoaded(true);
  }, [pageId]);
  useEffect(() => {
    if (enabled) void refresh();
  }, [enabled, refresh]);
  return { ...list, loaded, refresh };
}
