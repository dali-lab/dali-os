// The label for the tab the workspace seeds when the app is entered on a deep
// link.
//
// In tab mode the routed page never renders at top level — layout.tsx hands the
// main column to TabWorkspace instead of an <Outlet/> — so a URL the workspace
// does not seed as a tab is simply not shown: the user lands on whatever tab was
// active last, which for a first visit is Home. Seeding therefore cannot be
// conditional on having a nice label for the destination.
//
// The sidebar names the paths it owns (areas, their sub-tabs, the pinned
// Drive/Resources row). Everything else — a document, a file, a whiteboard, a
// form editor, a profile — has no nav home at all, and those are exactly the
// URLs people paste to each other. For those, the document title the server
// already rendered FOR THAT URL is the best label there is; the tab only gets
// relabelled from the iframe later if it navigates (see the `dali:setTabLabel`
// bridge in routes/layout.tsx, which deliberately keeps first-load titles from
// overwriting a friendly sidebar label).

const TITLE_SUFFIX = /\s*·\s*DALI OS\s*$/;

/** Titlecase the first path segment: "/profile/clx…" → "Profile". */
function fromPathname(pathname: string): string {
  const seg = pathname.split("/").filter(Boolean)[0];
  if (!seg) return "Page";
  return seg.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * @param navLabel the sidebar's label for this url, when it owns one
 * @param documentTitle `document.title` on the entry page (undefined server-side)
 * @param pathname the entry url's pathname, the last-resort label source
 */
export function deepLinkTabLabel(
  navLabel: string | undefined,
  documentTitle: string | undefined,
  pathname: string,
): string {
  if (navLabel) return navLabel;
  const titled = (documentTitle ?? "").replace(TITLE_SUFFIX, "").trim();
  if (titled && titled !== "DALI OS") return titled;
  return fromPathname(pathname);
}
