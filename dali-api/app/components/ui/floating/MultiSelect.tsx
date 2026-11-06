import { useId, useRef, useState, type ReactNode } from "react";
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

export type MultiSelectOption<T extends string = string> = SelectOption<T> & {
  /** Right-aligned on the row, e.g. a count. */
  trailing?: ReactNode;
};

/** The one value a single toggle added or removed, for callers that store
 *  toggles rather than lists. */
export function toggledValue<T>(prev: readonly T[], next: readonly T[]): T | undefined {
  return next.find((v) => !prev.includes(v)) ?? prev.find((v) => !next.includes(v));
}

function OptionRow<T extends string>({
  option,
  id,
  selected,
  active,
  rowRef,
  itemProps,
}: {
  option: MultiSelectOption<T>;
  id: string;
  selected: boolean;
  active: boolean;
  rowRef: (node: HTMLButtonElement | null) => void;
  itemProps: Record<string, unknown>;
}) {
  return (
    <li role="none">
      <button
        type="button"
        role="option"
        id={id}
        aria-selected={selected}
        disabled={option.disabled}
        ref={rowRef}
        className={cn(
          "flex w-full items-start gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors disabled:opacity-50",
          active ? "bg-os-container" : "hover:bg-os-container",
        )}
        {...itemProps}
      >
        <Check
          className={cn(
            "mt-0.5 h-3.5 w-3.5 shrink-0",
            selected ? "text-os-accent" : "opacity-0",
          )}
        />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex min-w-0 items-center gap-1.5 font-medium text-foreground">
            {option.icon}
            <span className="truncate">{option.label}</span>
          </span>
          {option.description && (
            <span className="text-xs text-muted-foreground">{option.description}</span>
          )}
        </span>
        {option.trailing}
      </button>
    </li>
  );
}

function ClearRow({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <div className="mt-1 border-t border-os-container pt-1">
      <button
        type="button"
        onClick={onClear}
        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-os-container hover:text-foreground"
      >
        <X className="h-3.5 w-3.5 shrink-0" aria-hidden />
        {label}
      </button>
    </div>
  );
}

/** The search box and toggle list on their own, for a menu that already owns
 *  its surface (a filter menu's second stage). MultiSelect renders this inside
 *  its own panel once it searches. */
export function MultiSelectList<T extends string = string>({
  values,
  options,
  onToggle,
  onClear,
  clearLabel,
  ariaLabel,
  searchPlaceholder = "Search",
  noMatchesLabel = "No matches",
  autoFocus = false,
}: {
  values: T[];
  options: MultiSelectOption<T>[];
  onToggle: (value: T) => void;
  onClear?: () => void;
  clearLabel?: string;
  ariaLabel?: string;
  searchPlaceholder?: string;
  noMatchesLabel?: string;
  autoFocus?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const listId = useId();
  const listRef = useRef<Array<HTMLElement | null>>([]);
  const selected = new Set(values);
  const shown = options.filter((o) => matchesQuery(o, query));

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

  return (
    <>
      <div className="sticky top-0 z-10 bg-os-card pb-1.5 pt-1.5">
        <SearchInput
          size="sm"
          autoFocus={autoFocus}
          value={query}
          placeholder={searchPlaceholder}
          role="combobox"
          aria-label={searchPlaceholder}
          aria-expanded
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={activeIndex !== null ? `${listId}-${activeIndex}` : undefined}
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
              if (pick && !pick.disabled) onToggle(pick.value);
            }
          }}
        />
      </div>
      <ul id={listId} role="listbox" aria-multiselectable aria-label={ariaLabel}>
        {shown.length === 0 ? (
          <li className="px-3 py-2 text-sm text-muted-foreground">{noMatchesLabel}</li>
        ) : (
          shown.map((o, i) => (
            <OptionRow
              key={o.value}
              option={o}
              id={`${listId}-${i}`}
              selected={selected.has(o.value)}
              active={i === activeIndex}
              rowRef={(node) => {
                listRef.current[i] = node;
              }}
              itemProps={{
                tabIndex: -1,
                onClick: () => {
                  if (!o.disabled) onToggle(o.value);
                },
              }}
            />
          ))
        )}
      </ul>
      {clearLabel && onClear && values.length > 0 && (
        <ClearRow label={clearLabel} onClear={onClear} />
      )}
    </>
  );
}

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
  renderTrigger,
  chips = true,
  clearLabel,
}: {
  values: T[];
  options: MultiSelectOption<T>[];
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
  /** Replaces the trigger's label and chevron. */
  renderTrigger?: (state: { chosen: MultiSelectOption<T>[]; open: boolean }) => ReactNode;
  /** Off when the caller shows the chosen values somewhere else. */
  chips?: boolean;
  /** Adds a footer row that empties the selection. */
  clearLabel?: string;
}) {
  const panelClass = usePanelClass();
  const triggerClass = useSelectTriggerClass();
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const listId = useId();
  const withSearch = searchable ?? options.length > SEARCH_THRESHOLD;

  const selected = new Set(values);
  // Chips follow the option order, not click order, so the row doesn't
  // reshuffle itself as things are picked and unpicked.
  const chosen = options.filter((o) => selected.has(o.value));

  function toggle(v: T) {
    onChange(
      selected.has(v) ? values.filter((x) => x !== v) : [...values, v],
    );
  }

  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: (o) => {
      setOpen(o);
      if (!o) setActiveIndex(null);
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
  labelsRef.current = options.map((o) => o.label);
  const disabledIndices = options.flatMap((o, i) => (o.disabled ? [i] : []));

  const { getReferenceProps, getFloatingProps, getItemProps } = useInteractions([
    useClick(context, { enabled: !disabled }),
    useDismiss(context),
    useRole(context, { role: "listbox", enabled: !withSearch }),
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

  const clear = () => onChange([]);

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      {name && values.map((v) => <input key={v} type="hidden" name={name} value={v} />)}
      <button
        ref={refs.setReference}
        type="button"
        disabled={disabled || options.length === 0}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={cn(
          "inline-flex items-center justify-between gap-1 disabled:opacity-60",
          buttonClassName ?? triggerClass,
        )}
        {...getReferenceProps()}
      >
        {renderTrigger ? (
          renderTrigger({ chosen, open })
        ) : (
          <>
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
          </>
        )}
      </button>

      {chips && chosen.length > 0 && (
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
          <FloatingFocusManager context={context} modal={false}>
            {withSearch ? (
              <div
                ref={refs.setFloating}
                style={floatingStyles}
                className={cn(panelClass, "flex max-w-[22rem] flex-col pt-0")}
                {...getFloatingProps()}
              >
                <MultiSelectList
                  values={values}
                  options={options}
                  onToggle={toggle}
                  onClear={clear}
                  clearLabel={clearLabel}
                  ariaLabel={ariaLabel}
                  searchPlaceholder={searchPlaceholder}
                  noMatchesLabel={noMatchesLabel}
                />
              </div>
            ) : (
              <div
                ref={refs.setFloating}
                style={floatingStyles}
                className={cn(panelClass, "max-w-[22rem]")}
                {...getFloatingProps()}
              >
                <ul id={listId} role="listbox" aria-multiselectable aria-label={ariaLabel}>
                  {options.map((o, i) => (
                    <OptionRow
                      key={o.value}
                      option={o}
                      id={`${listId}-${i}`}
                      selected={selected.has(o.value)}
                      active={i === activeIndex}
                      rowRef={(node) => {
                        listRef.current[i] = node;
                      }}
                      itemProps={getItemProps({
                        onClick: () => {
                          if (!o.disabled) toggle(o.value);
                        },
                      })}
                    />
                  ))}
                </ul>
                {clearLabel && values.length > 0 && <ClearRow label={clearLabel} onClear={clear} />}
              </div>
            )}
          </FloatingFocusManager>
        </FloatingPortal>
      )}
    </div>
  );
}
