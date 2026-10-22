import { useEffect, useState } from "react";

export type NoteTemplate = { id: string; title: string };

async function fetchTemplates(qs: string): Promise<NoteTemplate[]> {
  const res = await fetch(`/api/page-templates?${qs}`, { credentials: "include" });
  if (!res.ok) throw new Error("Failed to load templates");
  const json = (await res.json()) as { templates?: NoteTemplate[] };
  return json.templates ?? [];
}

/** Template pages the viewer can pick for a notebook: their own private set,
 *  the project's when the notebook belongs to one, then the lab's shared set. */
export function useNoteTemplates({ enabled = true, projectId = null }: { enabled?: boolean; projectId?: string | null } = {}) {
  const [templates, setTemplates] = useState<NoteTemplate[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setStatus("loading");
    void Promise.all([
      fetchTemplates("workspaceType=Member"),
      fetchTemplates("workspaceType=Lab"),
      projectId ? fetchTemplates(`workspaceType=Project&workspaceId=${encodeURIComponent(projectId)}`) : [],
    ])
      .then(([mine, lab, project]) => {
        if (cancelled) return;
        const seen = new Set<string>();
        setTemplates([...mine, ...project, ...lab].filter((t) => !seen.has(t.id) && seen.add(t.id)));
        setStatus("ready");
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, projectId]);

  return { templates, status };
}
