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
import { Tooltip } from "~/components/ui/floating";
import { GUIDE_OPEN_MESSAGE, postGuideState } from "./guide-bridge";

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

  // Inside a workspace iframe the shell's top bar carries this page's CTA, so
  // keep it told what this frame has. No-op in a top-level document, where the
  // shell reads the route itself.
  useEffect(() => {
    postGuideState({
      hasGuide: Boolean(docKey),
      open: Boolean(docKey && open),
    });
  }, [docKey, open]);

  // …and take the click back from the shell's copy.
  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (e.origin !== window.location.origin) return;
      if ((e.data as { type?: unknown } | null)?.type !== GUIDE_OPEN_MESSAGE) return;
      setOpen(true);
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [setOpen]);

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
// it, so the embedded layout provides it there itself: the top bar above that
// iframe owns the CTA too, reached over the guide bridge.
const ShellGuideContext = createContext(false);

export function ShellGuideProvider({ children }: { children: ReactNode }) {
  return <ShellGuideContext.Provider value>{children}</ShellGuideContext.Provider>;
}

/**
 * The top-bar CTA itself. Lives in the dali.os top bar beside the task bell
 * rather than on a page row, so it takes the bell's plate (`.os-topbar-btn`).
 *
 * Takes its click as a prop because the two shells reach the guide by
 * different routes: tabless mode shares a document with the page and opens it
 * straight through the context, while in tab mode the page is an iframe and
 * the shell posts to it over the guide bridge.
 */
export function GuideTopbarButton({ onClick }: { onClick: () => void }) {
  return (
    <Tooltip content="Open this page's guide">
      <button
        type="button"
        onClick={onClick}
        className="guide-pulse os-topbar-btn shrink-0 text-base font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-os-accent"
      >
        <BookOpen className="h-5 w-5 shrink-0" aria-hidden />
        Guide
      </button>
    </Tooltip>
  );
}

/**
 * Guide CTA. On pill pages AreaPillNav owns it; layout uses suppressWhenPills.
 *
 * `variant="topbar"` is the dali.os shell's copy for tabless mode, where the
 * shell shares this document with the page. It skips the page-row suppression
 * rules, which are about not stacking two CTAs on one row and don't apply
 * above the page, and it renders outside ShellGuideProvider, since it's the
 * copy that provider defers to.
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
  // The in-page pill row no longer renders under the dali.os shell.
  const hasAreaPills = false;
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
    return <GuideTopbarButton onClick={() => setOpen(true)} />;
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

  if (open && docKey) {
    // Under the os shell the layout never zeroes the outlet's top padding (its
    // sub-nav is an inline pill, not a flush bar), so there is nothing to put
    // back when the open guide replaces the outlet.
    const zeroedTopPadding = false;
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
