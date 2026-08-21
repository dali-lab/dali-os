import {
  createContext,
  lazy,
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useLocation, useMatches, useSearchParams } from "react-router";
import { BookOpen } from "lucide-react";
import type { DocHandle } from "~/components/Breadcrumbs";
import { useFeatureFlag } from "~/components/FeatureFlags";
import { hasSubnavRow } from "~/lib/nav-areas";

const PageDocPage = lazy(() =>
  import("./PageDocPage").then((m) => ({ default: m.PageDocPage })),
);

type PageDocContextValue = {
  docKey: string | undefined;
  docTitle: string | undefined;
  open: boolean;
  setOpen: (open: boolean) => void;
  focusCommentId: string | undefined;
};

const PageDocContext = createContext<PageDocContextValue | null>(null);

function useDocHandleFromMatches(searchParams: URLSearchParams): {
  docKey?: string;
  docTitle?: string;
} {
  const matches = useMatches();
  let docKey: string | undefined;
  let docTitle: string | undefined;
  let resolve: DocHandle["resolveDocKey"];
  for (const m of matches as { handle?: DocHandle }[]) {
    if (m.handle?.docKey) {
      docKey = m.handle.docKey;
      docTitle = m.handle.docTitle;
      resolve = m.handle.resolveDocKey;
    }
  }
  // Single-route pages (Drive) derive their guide key from the URL query; the
  // resolver overrides the static docKey when it returns a value.
  const derived = resolve?.(searchParams);
  return {
    docKey: derived?.key ?? docKey,
    docTitle: derived?.title ?? docTitle,
  };
}

export function PageDocProvider({ children }: { children: ReactNode }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const { docKey, docTitle } = useDocHandleFromMatches(searchParams);
  const [open, setOpenState] = useState(() => searchParams.get("doc") === "1");

  // Deep links (?doc=1) and in-app navigation onto a guided page.
  useEffect(() => {
    if (!docKey) {
      setOpenState(false);
      return;
    }
    if (searchParams.get("doc") === "1") setOpenState(true);
  }, [docKey, searchParams]);

  const setOpen = useCallback(
    (next: boolean) => {
      setOpenState(next);
      const params = new URLSearchParams(searchParams);
      if (next) {
        params.set("doc", "1");
      } else {
        params.delete("doc");
        params.delete("comment");
      }
      setSearchParams(params, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const focusCommentId = searchParams.get("comment") ?? undefined;

  const value = useMemo(
    () => ({
      docKey,
      docTitle,
      open: Boolean(docKey && open),
      setOpen,
      focusCommentId,
    }),
    [docKey, docTitle, open, setOpen, focusCommentId],
  );

  return <PageDocContext.Provider value={value}>{children}</PageDocContext.Provider>;
}

function usePageDoc(): PageDocContextValue {
  const ctx = useContext(PageDocContext);
  if (!ctx) throw new Error("PageDocProvider is required");
  return ctx;
}

// True inside a shell that carries its own Guide CTA above the page (the
// dali.os top bar). Every page-row copy under it stands down, or the page shows
// two. A workspace iframe is a separate document with no shell wrapped around
// it, so it never sees this and keeps its own row copy — which is what we want,
// since only the iframe's tree knows the route's docKey.
const ShellGuideContext = createContext(false);

export function ShellGuideProvider({ children }: { children: ReactNode }) {
  return <ShellGuideContext.Provider value>{children}</ShellGuideContext.Provider>;
}

/**
 * Guide CTA. On pill pages AreaPillNav owns it; layout uses suppressWhenPills.
 *
 * `variant="topbar"` is the dali.os shell's copy, which lives in the top bar
 * beside the task bell instead of on a page row — so it takes the bell's plate
 * (see `.os-topbar-btn`) and skips the page-row suppression rules, which are
 * about not stacking two CTAs on one row and don't apply above the page. It
 * renders outside ShellGuideProvider, since it's the copy that provider defers
 * to.
 */
export function PageDocButton({
  suppressWhenPills = false,
  variant = "default",
}: {
  suppressWhenPills?: boolean;
  variant?: "default" | "topbar";
}) {
  const matches = useMatches();
  const { docKey, open, setOpen } = usePageDoc();
  const shellOwnsGuide = useContext(ShellGuideContext);
  // Pills only render when the sidebar redesign is off; when it's on AreaPillNav
  // returns null, so the guide CTA belongs back on the breadcrumb row.
  const redesign = useFeatureFlag("sidebar-redesign");
  const hasAreaPills = !redesign && matches.some(
    (m) => (m as { handle?: { areaPills?: boolean } }).handle?.areaPills,
  );
  // `areaSubnav` routes (e.g. calendar) render their own subnav row that owns
  // the guide CTA, regardless of the redesign flag — so the layout's copy must
  // stand down there too, or the page shows two Guide buttons.
  const hasAreaSubnav = matches.some(
    (m) => (m as { handle?: { areaSubnav?: boolean } }).handle?.areaSubnav,
  );

  if (!docKey) return null;
  // The open guide renders its own Close (X) in the page header, so this CTA
  // only ever opens.
  if (open) return null;

  if (variant === "topbar") {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Open this page's guide"
        className="guide-pulse os-topbar-btn shrink-0 text-base font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-os-accent"
      >
        <BookOpen className="h-5 w-5 shrink-0" aria-hidden />
        Guide
      </button>
    );
  }

  if (shellOwnsGuide) return null;
  if (suppressWhenPills && (hasAreaPills || hasAreaSubnav)) return null;

  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      className="guide-pulse ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-full bg-accent-coral/10 px-3 py-1.5 text-sm font-semibold font-heading text-accent-coral ring-1 ring-inset ring-accent-coral/30 transition-colors hover:bg-accent-coral/20 hover:ring-accent-coral/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-coral"
    >
      <BookOpen className="h-4 w-4 shrink-0" aria-hidden />
      Guide
    </button>
  );
}

/** When the guide is open, replace the route outlet with the full-page guide. */
export function PageDocOutlet({ children }: { children: ReactNode }) {
  const { open, docKey, docTitle, setOpen, focusCommentId } = usePageDoc();
  const location = useLocation();
  const matches = useMatches();
  const redesignOpen = useFeatureFlag("sidebar-redesign");
  const osRedesign = useFeatureFlag("os-redesign");

  if (open && docKey) {
    // On pages with their own sub-nav row the layout zeroes its top padding
    // because that row supplies the spacing — but the open guide replaces the
    // outlet, sub-nav included, so nothing is left to space it off the
    // breadcrumb row. Ask the same predicate the layout asks (hasSubnavRow, in
    // nav-areas) and put the padding back exactly when it was zeroed; reading
    // `areaPills` alone missed `areaSubnav` pages and, under the sidebar
    // redesign, every page — leaving the guide title flush against the top.
    // Under os the layout never zeroes it (its sub-nav is an inline pill, not a
    // flush bar), so there is nothing to put back.
    const zeroedTopPadding = !osRedesign && hasSubnavRow(matches, redesignOpen);
    return (
      <div className={zeroedTopPadding ? "pt-4 sm:pt-8 md:pt-12" : undefined}>
        <Suspense
          fallback={
            <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
              Loading guide…
            </div>
          }
        >
          <PageDocPage
            docKey={docKey}
            fallbackTitle={docTitle ?? "Page guide"}
            path={location.pathname}
            focusCommentId={focusCommentId}
            onClose={() => setOpen(false)}
          />
        </Suspense>
      </div>
    );
  }
  return <>{children}</>;
}
