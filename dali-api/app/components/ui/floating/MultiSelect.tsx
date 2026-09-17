import { useRef, useState } from "react";
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
import { usePanelClass, useSelectTriggerClass } from "./os-styles";
import type { SelectOption } from "./Select";

// Select's plural: the same panel and the same option rows, but a pick toggles
// rather than commits, so the list stays open while several are chosen. What's
// chosen reads back as removable chips under the trigger — a summary alone
// ("3 selected") makes you open the panel to find out what the three are, which
// is the whole question when the values are things like story names.

export function MultiSelect<T extends string = string>({
  values,
  options,
  onChange,
  disabled = false,
  ariaLabel,
  placeholder = "None",
  align = "left",
  buttonClassName,
  emptyLabel = "Nothing to choose from",
}: {
  values: T[];
  options: SelectOption<T>[];
  onChange: (next: T[]) => void;
  disabled?: boolean;
  ariaLabel?: string;
  /** Shown on the trigger when nothing is selected. */
  placeholder?: string;
  align?: "left" | "right";
  buttonClassName?: string;
  /** Shown in place of the list when there are no options at all. */
  emptyLabel?: string;
}) {
  const panelClass = usePanelClass();
  const triggerClass = useSelectTriggerClass();
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

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
    useRole(context, { role: "listbox" }),
    useListNavigation(context, {
      listRef,
      activeIndex,
      onNavigate: setActiveIndex,
      disabledIndices,
      loop: true,
    }),
    useTypeahead(context, {
      listRef: labelsRef,
      activeIndex,
      onMatch: (index) => setActiveIndex(index),
      enabled: !disabled && open,
    }),
  ]);

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
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
            <ul
              ref={refs.setFloating}
              style={floatingStyles}
              className={cn(panelClass, "max-w-[22rem]")}
              aria-multiselectable
              {...getFloatingProps()}
            >
              {options.map((o, i) => {
                const isSelected = selected.has(o.value);
                return (
                  <li key={o.value} role="none">
                    <button
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      disabled={o.disabled}
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
              })}
            </ul>
          </FloatingFocusManager>
        </FloatingPortal>
      )}
    </div>
  );
}
