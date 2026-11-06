import { useId, useRef, useState } from "react";
import {
  autoUpdate,
  flip,
  offset,
  shift,
  size,
  useClick,
  useDismiss,
  useFloating,
  useInteractions,
  useListNavigation,
  useRole,
  useTypeahead,
  FloatingFocusManager,
  FloatingPortal,
} from "@floating-ui/react";
import { Check, ChevronDown, X } from "lucide-react";
import { cn } from "~/lib/cn";
import { SearchInput } from "~/components/ui/SearchInput";
import { usePanelClass, useSelectTriggerClass } from "./os-styles";
import type { SelectOption } from "./Select";
import { SEARCH_THRESHOLD, matchesQuery } from "./search";

// Select's plural: the same panel and the same option rows, but a pick toggles
// rather than commits, so the list stays open while several are chosen. What's
// chosen reads back as removable chips under the trigger — a summary alone
// ("3 selected") makes you open the panel to find out what the three are, which
// is the whole question when the values are things like story names.

export function MultiSelect<T extends string = string>({
  values,
  options,
  onChange,
  name,
  disabled = false,
  ariaLabel,
  placeholder = "None",
  align = "left",
  buttonClassName,
  emptyLabel = "Nothing to choose from",
  searchable,
  searchPlaceholder = "Search",
  noMatchesLabel = "No matches",
}: {
  values: T[];
  options: SelectOption<T>[];
  onChange: (next: T[]) => void;
  /** Posts one hidden input per chosen value under this name. */
  name?: string;
  disabled?: boolean;
  ariaLabel?: string;
  /** Shown on the trigger when nothing is selected. */
  placeholder?: string;
  align?: "left" | "right";
  buttonClassName?: string;
  /** Shown in place of the list when there are no options at all. */
  emptyLabel?: string;
  /** Defaults to on once the list is longer than SEARCH_THRESHOLD. */
  searchable?: boolean;
  searchPlaceholder?: string;
  noMatchesLabel?: string;
}) {
  const panelClass = usePanelClass();
  const triggerClass = useSelectTriggerClass();
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement | null>(null);
  const listId = useId();
  const withSearch = searchable ?? options.length > SEARCH_THRESHOLD;

  const selected = new Set(values);
  // Chips follow the option order, not click order, so the row doesn't
  // reshuffle itself as things are picked and unpicked.
  const chosen = options.filter((o) => selected.has(o.value));
  const shown = withSearch ? options.filter((o) => matchesQuery(o, query)) : options;

  function toggle(v: T) {
    onChange(
      selected.has(v) ? values.filter((x) => x !== v) : [...values, v],
    );
  }

  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: (o) => {
      setOpen(o);
      if (!o) {
        setActiveIndex(null);
        setQuery("");
      }
    },
    placement: align === "right" ? "bottom-end" : "bottom-start",
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
            maxHeight: `${Math.min(availableHeight, 320)}px`,
          });
        },
      }),
    ],
  });

  const listRef = useRef<Array<HTMLElement | null>>([]);
  const labelsRef = useRef<Array<string>>([]);
  labelsRef.current = shown.map((o) => o.label);
  const disabledIndices = shown.flatMap((o, i) => (o.disabled ? [i] : []));

  const { getReferenceProps, getFloatingProps, getItemProps } = useInteractions([
    useClick(context, { enabled: !disabled }),
    useDismiss(context),
    useRole(context, { role: withSearch ? "dialog" : "listbox" }),
    useListNavigation(context, {
      listRef,
      activeIndex,
      onNavigate: setActiveIndex,
      disabledIndices,
      loop: true,
      enabled: !withSearch,
    }),
    useTypeahead(context, {
      listRef: labelsRef,
      activeIndex,
      onMatch: (index) => setActiveIndex(index),
      enabled: !disabled && open && !withSearch,
    }),
  ]);

  function moveActive(step: 1 | -1) {
    const enabled = shown.flatMap((o, i) => (o.disabled ? [] : [i]));
    if (enabled.length === 0) return;
    const at = activeIndex === null ? -1 : enabled.indexOf(activeIndex);
    const next =
      at === -1
        ? enabled[step === 1 ? 0 : enabled.length - 1]
        : enabled[(at + step + enabled.length) % enabled.length];
    setActiveIndex(next);
    listRef.current[next]?.scrollIntoView?.({ block: "nearest" });
  }

  const optionRows = shown.map((o, i) => {
    const isSelected = selected.has(o.value);
    return (
      <li key={o.value} role="none">
        <button
          type="button"
          role="option"
          id={`${listId}-${i}`}
          aria-selected={isSelected}
          disabled={o.disabled}
          tabIndex={withSearch ? -1 : undefined}
          ref={(node) => {
            listRef.current[i] = node;
          }}
          className={cn(
            "flex w-full items-start gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors disabled:opacity-50",
            i === activeIndex ? "bg-os-container" : "hover:bg-os-container",
          )}
          {...getItemProps({
            onClick: () => {
              if (!o.disabled) toggle(o.value);
            },
          })}
        >
          <Check
            className={cn(
              "mt-0.5 h-3.5 w-3.5 shrink-0",
              isSelected ? "text-os-accent" : "opacity-0",
            )}
          />
          <span className="flex min-w-0 flex-col">
            <span className="flex items-center gap-1.5 font-medium text-foreground">
              {o.icon}
              {o.label}
            </span>
            {o.description && (
              <span className="text-xs text-muted-foreground">
                {o.description}
              </span>
            )}
          </span>
        </button>
      </li>
    );
  });

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      {name && values.map((v) => <input key={v} type="hidden" name={name} value={v} />)}
      <button
        ref={refs.setReference}
        type="button"
        disabled={disabled || options.length === 0}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        className={cn(
          "inline-flex items-center justify-between gap-1 disabled:opacity-60",
          buttonClassName ?? triggerClass,
        )}
        {...getReferenceProps()}
      >
        <span
          className={cn(
            "min-w-0 truncate",
            chosen.length === 0 && "text-muted-foreground",
          )}
        >
          {chosen.length === 0
            ? options.length === 0
              ? emptyLabel
              : placeholder
            : `${chosen.length} selected`}
        </span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      </button>

      {chosen.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {chosen.map((o) => (
            <li key={o.value}>
              <span className="inline-flex max-w-full items-center gap-1 rounded-full border border-os-container bg-os-well py-1 pl-2.5 pr-1 text-xs text-foreground">
                {o.icon}
                <span className="truncate">{o.label}</span>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => toggle(o.value)}
                  aria-label={`Remove ${o.label}`}
                  className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-os-grey transition-colors hover:bg-os-container hover:text-foreground"
                >
                  <X className="h-3 w-3" aria-hidden />
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      {open && (
        <FloatingPortal>
          <FloatingFocusManager
            context={context}
            modal={false}
            initialFocus={withSearch ? searchRef : undefined}
          >
            {withSearch ? (
              <div
                ref={refs.setFloating}
                style={floatingStyles}
                className={cn(panelClass, "flex max-w-[22rem] flex-col pt-0")}
                {...getFloatingProps()}
              >
                <div className="sticky top-0 z-10 bg-os-card pb-1.5 pt-1.5">
                  <SearchInput
                    ref={searchRef}
                    size="sm"
                    value={query}
                    placeholder={searchPlaceholder}
                    role="combobox"
                    aria-label={ariaLabel ? `Search ${ariaLabel}` : searchPlaceholder}
                    aria-expanded
                    aria-controls={listId}
                    aria-autocomplete="list"
                    aria-activedescendant={
                      activeIndex !== null ? `${listId}-${activeIndex}` : undefined
                    }
                    onChange={(e) => {
                      setQuery(e.target.value);
                      setActiveIndex(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                        e.preventDefault();
                        moveActive(e.key === "ArrowDown" ? 1 : -1);
                      } else if (e.key === "Enter") {
                        e.preventDefault();
                        const pick = activeIndex !== null ? shown[activeIndex] : undefined;
                        if (pick && !pick.disabled) toggle(pick.value);
                      }
                    }}
                  />
                </div>
                <ul id={listId} role="listbox" aria-multiselectable>
                  {shown.length === 0 ? (
                    <li className="px-3 py-2 text-sm text-muted-foreground">{noMatchesLabel}</li>
                  ) : (
                    optionRows
                  )}
                </ul>
              </div>
            ) : (
              <ul
                ref={refs.setFloating}
                id={listId}
                style={floatingStyles}
                className={cn(panelClass, "max-w-[22rem]")}
                aria-multiselectable
                {...getFloatingProps()}
              >
                {optionRows}
              </ul>
            )}
          </FloatingFocusManager>
        </FloatingPortal>
      )}
    </div>
  );
}
