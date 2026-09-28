import { useEffect, useMemo, useRef, useState } from "react";
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
import { usePanelClass } from "~/components/ui/floating/os-styles";
import { cn } from "~/lib/cn";

export type KnownAddress = { name: string; address: string };

const MAX_SUGGESTIONS = 8;
const REMOTE_MIN_CHARS = 2;
const REMOTE_DEBOUNCE_MS = 150;

// Lab members from /api/email/contacts, keyed by query. Module-level so the
// To/Cc/Bcc fields and reopened composers share it for the session.
const remoteCache = new Map<string, KnownAddress[]>();

function useDirectoryMatches(token: string): KnownAddress[] {
  const q = token.trim().toLowerCase();
  const [results, setResults] = useState<{ q: string; contacts: KnownAddress[] }>({ q: "", contacts: [] });

  useEffect(() => {
    if (q.length < REMOTE_MIN_CHARS) return;
    const cached = remoteCache.get(q);
    if (cached) {
      setResults({ q, contacts: cached });
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/email/contacts?q=${encodeURIComponent(q)}`, { signal: controller.signal });
        if (!res.ok) return;
        const { contacts } = (await res.json()) as { contacts: KnownAddress[] };
        remoteCache.set(q, contacts);
        setResults({ q, contacts });
      } catch {
        // Aborted by the next keystroke, or offline — local matches still show.
      }
    }, REMOTE_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [q]);

  // Only show results for what's typed now, never a previous query's.
  return results.q === q ? results.contacts : [];
}

type Suggestion = { value: string; label: string; hint?: string };

const personOption = (k: KnownAddress): Suggestion => ({
  value: k.address,
  label: k.name || k.address,
  hint: k.name ? k.address : undefined,
});

// Suggestions for the address being typed — the part after the last comma:
// people seen in the mailbox first, then lab members from the directory, then
// (once there's an "@") domain completions.
export function addressSuggestions(
  token: string,
  known: KnownAddress[],
  domains: string[],
  directory: KnownAddress[] = [],
): Suggestion[] {
  const q = token.trim().toLowerCase();
  if (!q) return [];
  const at = q.indexOf("@");
  if (at <= 0 && q.length < 2) return [];

  const local = known.filter(
    (k) =>
      k.address.toLowerCase().startsWith(q) ||
      (at < 0 && k.name.toLowerCase().split(/\s+/).some((w) => w.startsWith(q))),
  );
  const seen = new Set<string>();
  const options: Suggestion[] = [];
  const add = (o: Suggestion) => {
    const key = o.value.toLowerCase();
    if (key === q || seen.has(key)) return;
    seen.add(key);
    options.push(o);
  };
  local.forEach((k) => add(personOption(k)));
  directory.forEach((k) => add(personOption(k)));
  if (at > 0) {
    const name = token.trim().slice(0, at);
    const partial = q.slice(at + 1);
    domains
      .filter((d) => d.startsWith(partial) && d !== partial)
      .forEach((d) => add({ value: `${name}@${d}`, label: `${name}@${d}` }));
  }
  return options.slice(0, MAX_SUGGESTIONS);
}

// A comma-separated address field that autocompletes the address being typed.
// Focus stays in the input; the list is navigated virtually (see Combobox).
export function AddressInput({
  value,
  onChange,
  known,
  domains,
  ariaLabel,
  placeholder,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  known: KnownAddress[];
  domains: string[];
  ariaLabel: string;
  placeholder?: string;
  className?: string;
}) {
  const panelClass = usePanelClass();
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [activeIndex, setActiveIndex] = useState<number | null>(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<Array<HTMLElement | null>>([]);

  const cut = value.lastIndexOf(",") + 1;
  const token = value.slice(cut);
  const directory = useDirectoryMatches(focused ? token : "");
  const suggestions = useMemo(
    () => addressSuggestions(token, known, domains, directory),
    [token, known, domains, directory],
  );
  const open = focused && !dismissed && suggestions.length > 0;

  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: (o) => {
      if (!o) setDismissed(true);
    },
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
            minWidth: `${Math.min(rects.reference.width, 320)}px`,
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

  const choose = (address: string) => {
    const head = value.slice(0, cut).trimEnd();
    onChange(`${head ? `${head} ` : ""}${address}, `);
    setActiveIndex(0);
    inputRef.current?.focus();
  };

  const listId = `${ariaLabel.toLowerCase()}-suggestions`;

  return (
    <>
      <input
        ref={(node) => {
          inputRef.current = node;
          refs.setReference(node);
        }}
        type="text"
        role="combobox"
        autoComplete="off"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && activeIndex !== null ? `${listId}-${activeIndex}` : undefined}
        aria-autocomplete="list"
        placeholder={placeholder}
        value={value}
        className={className}
        {...getReferenceProps({
          onFocus: () => setFocused(true),
          onBlur: () => {
            setFocused(false);
            setDismissed(false);
          },
          onChange: (e) => {
            onChange((e.target as HTMLInputElement).value);
            setDismissed(false);
            setActiveIndex(0);
          },
          onKeyDown: (e) => {
            if (!open) return;
            const pick = activeIndex !== null ? suggestions[activeIndex] : undefined;
            if ((e.key === "Enter" || e.key === "Tab") && pick) {
              e.preventDefault();
              choose(pick.value);
            } else if (e.key === "Escape") {
              e.preventDefault();
              setDismissed(true);
            }
          },
        })}
      />
      {open && (
        <FloatingPortal>
          <ul
            ref={refs.setFloating}
            id={listId}
            style={floatingStyles}
            className={cn(panelClass, "max-w-[22rem] overflow-y-auto")}
            {...getFloatingProps()}
          >
            {suggestions.map((s, i) => (
              <li key={s.value} role="none">
                <button
                  type="button"
                  role="option"
                  id={`${listId}-${i}`}
                  aria-selected={i === activeIndex}
                  tabIndex={-1}
                  ref={(node) => {
                    listRef.current[i] = node;
                  }}
                  className={cn(
                    "flex w-full flex-col rounded-lg px-3 py-1.5 text-left text-sm transition-colors",
                    i === activeIndex ? "bg-os-container" : "hover:bg-os-container",
                  )}
                  {...getItemProps({
                    onMouseDown: (e) => e.preventDefault(),
                    onClick: () => choose(s.value),
                  })}
                >
                  <span className="truncate text-foreground">{s.label}</span>
                  {s.hint && <span className="truncate text-xs text-os-muted">{s.hint}</span>}
                </button>
              </li>
            ))}
          </ul>
        </FloatingPortal>
      )}
    </>
  );
}
