import { useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";
import {
  autoUpdate,
  flip,
  offset,
  shift,
  size,
  useDismiss,
  useFloating,
  useInteractions,
  useListNavigation,
  useRole,
  FloatingPortal,
} from "@floating-ui/react";
import { Link2, Unlink } from "lucide-react";
import { usePanelClass } from "~/components/ui/floating/os-styles";
import { Avatar } from "~/components/ui/Avatar";
import { IconButton } from "~/components/ui/IconButton";
import { useDialog } from "~/components/ui/dialog";
import { useToast } from "~/components/ui/toast";
import { cn } from "~/lib/cn";

type ApplicantLink = { userId: string; name: string; photoUrl: string | null; source: "Auto" | "Manual" };
type SearchResult = { id: string; name: string; photoUrl: string | null; email: string };

const MIN_CHARS = 2;
const DEBOUNCE_MS = 150;

function useUserSearch(query: string): SearchResult[] {
  const [results, setResults] = useState<{ q: string; users: SearchResult[] }>({ q: "", users: [] });
  useEffect(() => {
    const q = query.trim();
    if (q.length < MIN_CHARS) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/users/search?q=${encodeURIComponent(q)}`, { signal: controller.signal });
        if (!res.ok) return;
        const { users } = (await res.json()) as { users: SearchResult[] };
        setResults({ q, users });
      } catch {
        // Aborted by the next keystroke.
      }
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);
  return results.q === query.trim() ? results.users : [];
}

// "Linked applicant" section of a Shared-inbox thread: who this thread is
// matched to (by address, or by hand), with manual link/unlink. Sits directly
// above the Private comments section in ThreadView.
export function ApplicantLinkSection({
  accountId,
  threadId,
  link,
}: {
  accountId: string;
  threadId: string;
  link: ApplicantLink | null;
}) {
  const fetcher = useFetcher<{ ok?: boolean; warning?: string; error?: string }>();
  const dialog = useDialog();
  const toast = useToast();
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const [activeIndex, setActiveIndex] = useState<number | null>(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<Array<HTMLElement | null>>([]);
  const panelClass = usePanelClass();
  const results = useUserSearch(query);
  const open = focused && results.length > 0;

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data) {
      if (fetcher.data.warning) toast.info(fetcher.data.warning);
      else if (fetcher.data.error) toast.error(fetcher.data.error);
    }
  }, [fetcher.state, fetcher.data]);

  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: (o) => setFocused(o),
    placement: "bottom-start",
    whileElementsMounted: autoUpdate,
    middleware: [
      offset(4),
      flip({ padding: 8 }),
      shift({ padding: 8 }),
      size({
        padding: 8,
        apply({ rects, elements, availableHeight }) {
          Object.assign(elements.floating.style, {
            minWidth: `${rects.reference.width}px`,
            maxHeight: `${Math.min(availableHeight, 280)}px`,
          });
        },
      }),
    ],
  });
  const dismiss = useDismiss(context);
  const role = useRole(context, { role: "listbox" });
  const listNav = useListNavigation(context, {
    listRef,
    activeIndex,
    onNavigate: setActiveIndex,
    virtual: true,
    loop: true,
  });
  const { getReferenceProps, getFloatingProps, getItemProps } = useInteractions([dismiss, role, listNav]);

  function handleLink(userId: string) {
    fetcher.submit({ intent: "linkApplicant", accountId, threadId, userId }, { method: "post" });
    setQuery("");
    setFocused(false);
  }

  async function unlink() {
    const ok = await dialog.confirm({
      title: "Unlink this applicant?",
      description: "You can relink it later, or auto-linking will pick it up again on the next sync.",
      confirmLabel: "Unlink",
      tone: "destructive",
    });
    if (!ok) return;
    fetcher.submit({ intent: "unlinkApplicant", accountId, threadId }, { method: "post" });
  }

  const listId = "applicant-link-suggestions";

  return (
    <section className="flex items-center gap-2 rounded-os-card bg-os-container/60 px-4 py-3">
      {link ? (
        <>
          <Avatar name={link.name} photoUrl={link.photoUrl} userId={link.userId} size="xs" />
          <span className="min-w-0 flex-1 truncate text-sm text-foreground">
            <span className="font-semibold">{link.name}</span>
          </span>
          <span className="shrink-0 rounded-full bg-os-container px-2 py-0.5 text-[11px] font-medium text-os-muted">
            {link.source === "Auto" ? "Matched by address" : "Linked by hand"}
          </span>
          <IconButton label="Unlink applicant" icon={Unlink} onClick={unlink} />
        </>
      ) : (
        <>
          <Link2 className="h-4 w-4 shrink-0 text-os-muted" />
          <div className="relative min-w-0 flex-1">
            <input
              ref={(node) => {
                inputRef.current = node;
                refs.setReference(node);
              }}
              type="text"
              role="combobox"
              aria-expanded={open}
              aria-controls={open ? listId : undefined}
              aria-autocomplete="list"
              aria-label="Link an applicant"
              placeholder="No applicant linked. Search to link one…"
              value={query}
              className="w-full min-w-0 bg-transparent text-sm text-foreground placeholder:text-os-muted focus:outline-none"
              {...getReferenceProps({
                onFocus: () => setFocused(true),
                onBlur: () => setFocused(false),
                onChange: (e) => {
                  setQuery((e.target as HTMLInputElement).value);
                  setActiveIndex(0);
                },
              })}
            />
          </div>
          {open && (
            <FloatingPortal>
              <ul
                ref={refs.setFloating}
                id={listId}
                style={floatingStyles}
                className={cn(panelClass, "max-w-[20rem] overflow-y-auto")}
                {...getFloatingProps()}
              >
                {results.map((r, i) => (
                  <li key={r.id} role="none">
                    <button
                      type="button"
                      role="option"
                      aria-selected={i === activeIndex}
                      tabIndex={-1}
                      ref={(node) => {
                        listRef.current[i] = node;
                      }}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left text-sm transition-colors",
                        i === activeIndex ? "bg-os-container" : "hover:bg-os-container",
                      )}
                      {...getItemProps({
                        onMouseDown: (e) => e.preventDefault(),
                        onClick: () => handleLink(r.id),
                      })}
                    >
                      <Avatar name={r.name} photoUrl={r.photoUrl} userId={r.id} size="xs" />
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate text-foreground">{r.name}</span>
                        <span className="truncate text-xs text-os-muted">{r.email}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </FloatingPortal>
          )}
        </>
      )}
    </section>
  );
}
