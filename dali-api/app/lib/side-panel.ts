// The side panel: one item shown beside the routed page, named in the url as
// `?side=<type>:<id>` so a reload, a copied link, and Back all keep it. It is a
// view rendered from data, not a second route, so it works in the browser and
// the desktop app alike.

export const SIDE_PARAM = "side";

export type SidePanel = { type: "doc"; id: string };

const TYPES = new Set<SidePanel["type"]>(["doc"]);

export function parseSidePanel(value: string | null | undefined): SidePanel | null {
  if (!value) return null;
  const at = value.indexOf(":");
  if (at <= 0) return null;
  const type = value.slice(0, at) as SidePanel["type"];
  const id = value.slice(at + 1);
  if (!TYPES.has(type) || !/^[\w-]+$/.test(id)) return null;
  return { type, id };
}

export function formatSidePanel(panel: SidePanel): string {
  return `${panel.type}:${panel.id}`;
}

/** The page a panel item opens as when promoted to the main view. */
export function sidePanelHref(panel: SidePanel): string {
  return `/documents/${panel.id}`;
}

/** The side panel a url asks to open beside its page, e.g. a palette result. */
export function sidePanelForUrl(url: string): SidePanel | null {
  const m = /^\/documents\/([\w-]+)\/?(?:[?#].*)?$/.exec(url);
  return m ? { type: "doc", id: m[1] } : null;
}

export type PanelLoad =
  | { kind: "doc"; data: unknown }
  | { kind: "follow"; pageId: string }
  | { kind: "elsewhere"; href: string }
  | { kind: "missing" };

/**
 * Classify what the document route's loader returned for a panel. A redirect
 * to another document is followed (a notebook opening on its latest note); a
 * redirect anywhere else (a folder, a whiteboard, a login) can't show in the
 * panel, so it offers a link instead.
 */
export function resolvePanelLoad(result: unknown, pageId: string): PanelLoad {
  if (result instanceof Response) {
    const location = result.headers.get("Location");
    if (result.status >= 300 && result.status < 400 && location) {
      const doc = /^\/documents\/([\w-]+)(?:[?#]|$)/.exec(location);
      return doc ? { kind: "follow", pageId: doc[1] } : { kind: "elsewhere", href: location };
    }
    return { kind: "missing" };
  }
  if (result && typeof result === "object" && "emptyNotebook" in result) {
    return { kind: "elsewhere", href: `/documents/${pageId}` };
  }
  if (result && typeof result === "object" && "pageId" in result) return { kind: "doc", data: result };
  return { kind: "missing" };
}
