import type { SlideClip } from "~/components/slides/deck/slide-clipboard";

export interface TemplateRow {
  id: string;
  kind: "Deck" | "Slide";
  title: string;
  themeId: string;
  slideCount: number;
  scope: "lab" | "project";
  firstLayoutId: string | null;
  canDelete: boolean;
}

export interface TemplateList {
  templates: TemplateRow[];
  canSaveToProject: boolean;
}

export interface SaveTemplateInput {
  kind: "Deck" | "Slide";
  title: string;
  pageId: string;
  scope: "lab" | "project";
  themeId: string;
  slides: unknown[];
}

const errorOf = async (res: Response, fallback: string) => ((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? fallback;

export async function fetchTemplates(pageId: string): Promise<TemplateList | null> {
  try {
    const res = await fetch(`/api/slide-templates?pageId=${encodeURIComponent(pageId)}`, { credentials: "same-origin" });
    return res.ok ? ((await res.json()) as TemplateList) : null;
  } catch {
    return null;
  }
}

export async function fetchTemplate(id: string): Promise<(TemplateRow & { slides: SlideClip[] }) | null> {
  try {
    const res = await fetch(`/api/slide-templates/${encodeURIComponent(id)}`, { credentials: "same-origin" });
    return res.ok ? ((await res.json()) as TemplateRow & { slides: SlideClip[] }) : null;
  } catch {
    return null;
  }
}

export async function saveTemplate(input: SaveTemplateInput): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await fetch("/api/slide-templates", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    return res.ok ? { ok: true } : { ok: false, error: await errorOf(res, "Couldn't save the template.") };
  } catch {
    return { ok: false, error: "Couldn't save the template." };
  }
}

export async function removeTemplate(id: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/slide-templates/${encodeURIComponent(id)}`, { method: "DELETE", credentials: "same-origin" });
    return res.ok;
  } catch {
    return false;
  }
}

export async function applyTemplateToDeck(pageId: string, templateId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await fetch(`/api/slides/${encodeURIComponent(pageId)}/from-template`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ templateId }),
    });
    return res.ok ? { ok: true } : { ok: false, error: await errorOf(res, "Couldn't start from that template.") };
  } catch {
    return { ok: false, error: "Couldn't start from that template." };
  }
}

export async function fetchScopeTemplates(projectId: string | null): Promise<TemplateRow[]> {
  try {
    const q = projectId ? `?projectId=${encodeURIComponent(projectId)}` : "";
    const res = await fetch(`/api/slide-templates${q}`, { credentials: "same-origin" });
    return res.ok ? ((await res.json()) as { templates: TemplateRow[] }).templates : [];
  } catch {
    return [];
  }
}
