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
import { Tooltip } from "~/components/ui/floating";

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

/**
 * The top-bar CTA itself. Lives in the dali.os top bar beside the task bell
 * rather than on a page row, so it takes the bell's plate (`.os-topbar-btn`).
 *
 */
export function GuideTopbarButton({ onClick, compact = false }: { onClick: () => void; compact?: boolean }) {
  if (compact) {
    return (
      <Tooltip content="Open this page's guide">
        <button
          type="button"
          onClick={onClick}
          aria-label="Open this page's guide"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-os-grey transition-colors hover:bg-os-hover hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-os-accent"
        >
          <BookOpen className="h-[18px] w-[18px]" aria-hidden />
        </button>
      </Tooltip>
    );
  }
  return (
    <Tooltip content="Open this page's guide">
      <button
        type="button"
        onClick={onClick}
        className="os-topbar-btn shrink-0 text-base font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-os-accent"
      >
        <BookOpen className="h-5 w-5 shrink-0" aria-hidden />
        Guide
      </button>
    </Tooltip>
  );
}

/**
 * Guide CTA for the shell: `topbar` is the dali.os top bar's copy, `pagebar`
 * the compact one in the page bar.
 */
export function PageDocButton({ variant }: { variant: "topbar" | "pagebar" }) {
  const { docKey, open, setOpen } = usePageDoc();

  if (!docKey) return null;
  // The open guide renders its own Close (X) in the page header, so this CTA
  // only ever opens.
  if (open) return null;

  return <GuideTopbarButton compact={variant === "pagebar"} onClick={() => setOpen(true)} />;
}

/** When the guide is open, replace the route outlet with the full-page guide. */
export function PageDocOutlet({ children }: { children: ReactNode }) {
  const { open, docKey, docTitle, setOpen, focusCommentId } = usePageDoc();
  const location = useLocation();
  const matches = useMatches();

  if (open && docKey) {
    // Viewport-fitted pages (home, email, calendar) bound the shell and scroll
    // their own panes, so the guide that replaces them needs its own scroller.
    return (
      <div className="min-h-0 flex-1 overflow-y-auto">
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
