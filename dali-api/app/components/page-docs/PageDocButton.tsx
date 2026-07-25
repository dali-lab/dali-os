import { lazy, Suspense, useEffect, useState } from "react";
import { useMatches, useLocation } from "react-router";
import { BookOpen } from "lucide-react";
import type { DocHandle } from "~/components/Breadcrumbs";

// The lazily-loaded modal pulls in the rich-text editor + comments rail; keep it
// out of the initial layout bundle since most page views never open it.
const PageDocModal = lazy(() =>
  import("./PageDocModal").then((m) => ({ default: m.PageDocModal })),
);

// Surfaces a "Docs" button on any page whose deepest matched route declares
// handle.docKey; renders nothing otherwise. Two placements avoid a lonely,
// floating row: on pages with an AreaPillNav the button rides that pill row
// (AreaPillNav renders it), and the global layout instance suppresses itself
// there via suppressWhenPills. Non-pill detail pages keep the layout instance,
// which sits in the breadcrumb row.
export function PageDocButton({ suppressWhenPills = false }: { suppressWhenPills?: boolean }) {
  const matches = useMatches();
  const location = useLocation();
  const [open, setOpen] = useState(false);

  // Deepest match wins, mirroring Breadcrumbs.headerAction.
  let docKey: string | undefined;
  let docTitle: string | undefined;
  for (const m of matches as { handle?: DocHandle & { areaPills?: boolean } }[]) {
    if (m.handle?.docKey) {
      docKey = m.handle.docKey;
      docTitle = m.handle.docTitle;
    }
  }
  const hasAreaPills = matches.some(
    (m) => (m as { handle?: { areaPills?: boolean } }).handle?.areaPills,
  );

  // Mention/maintainer notifications deep-link with ?doc=1 — open on arrival.
  useEffect(() => {
    if (!docKey) return;
    const params = new URLSearchParams(location.search);
    if (params.get("doc") === "1") setOpen(true);
  }, [docKey, location.search]);

  if (!docKey) return null;
  // On pill pages the AreaPillNav instance owns the button; the layout instance
  // steps aside so it doesn't render twice (or float in an empty row).
  if (suppressWhenPills && hasAreaPills) return null;

  return (
    <>
      {/* Right-aligned peer of the section tabs, but deliberately louder than
          the nav pills: a coral CTA pill with a slow recurring glow
          (guide-pulse) so first-time visitors notice the page has a guide.
          Same Dosis (font-heading) type as the pills. */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="guide-pulse ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-full bg-accent-coral/10 px-3 py-1.5 text-sm font-semibold font-heading text-accent-coral ring-1 ring-inset ring-accent-coral/30 transition-colors hover:bg-accent-coral/20 hover:ring-accent-coral/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-coral"
      >
        <BookOpen className="h-4 w-4 shrink-0" aria-hidden />
        Guide
      </button>
      {open && (
        <Suspense fallback={null}>
          <PageDocModal
            docKey={docKey}
            fallbackTitle={docTitle ?? "Page guide"}
            path={location.pathname}
            focusCommentId={new URLSearchParams(location.search).get("comment") ?? undefined}
            onClose={() => setOpen(false)}
          />
        </Suspense>
      )}
    </>
  );
}
