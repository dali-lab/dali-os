import { useMemo, useRef, useState, type ReactNode } from "react";
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
import { Check, ChevronDown } from "lucide-react";
import { cn } from "~/lib/cn";
import { usePanelClass } from "./os-styles";
import type { SelectOption } from "./Select";

// A Select you can type into: the trigger is the input, and what you type
// narrows the list under it. Select stays the right control for a short, fixed
// set of choices; this one is for lists long enough that scanning them is the
// slow part (terms, tags, people).
//
// Focus stays in the input the whole time — the list is navigated virtually via
// aria-activedescendant, which is what lets the caret keep working while the
// arrow keys move the highlight. Blur and Escape restore the selected label, so
// an abandoned query can never leave the trigger reading as something that
// isn't the current value.

export function Combobox<T extends string = string>({
  value,
  options,
  onChange,
  disabled = false,
  ariaLabel,
  placeholder,
  align = "left",
  className,
  /** Rendered inside the trigger, left of the text (a filter's icon). */
  icon,
  /** Shown in place of the list when nothing matches what was typed. */
  emptyLabel = "No matches",
}: {
  value: T;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
  ariaLabel?: string;
  placeholder?: string;
  align?: "left" | "right";
  className?: string;
  icon?: ReactNode;
  emptyLabel?: string;
}) {
  const panelClass = usePanelClass();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<Array<HTMLElement | null>>([]);

  const current = options.find((o) => o.value === value);
  const selectedLabel = current?.label ?? "";

  // Typing filters; opening without typing shows everything, so the control
  // still works as a plain dropdown for anyone who never touches the keyboard.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, query]);

  function close() {
    setOpen(false);
    setQuery("");
    setActiveIndex(null);
  }

  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: (o) => (o ? setOpen(true) : close()),
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

  const dismiss = useDismiss(context);
  const role = useRole(context, { role: "listbox" });
  const listNav = useListNavigation(context, {
    listRef,
    activeIndex,
    onNavigate: setActiveIndex,
    // The highlight moves without stealing focus from the input.
    virtual: true,
    loop: true,
  });
  const { getReferenceProps, getFloatingProps, getItemProps } = useInteractions([
    dismiss,
    role,
    listNav,
  ]);

  function choose(v: T) {
    onChange(v);
    close();
    inputRef.current?.blur();
  }

  const listId = `${ariaLabel ?? "combobox"}-list`;

  return (
    <>
      <div
        ref={refs.setReference}
        className={cn(
          "relative inline-flex items-center gap-2 focus-within:border-os-accent",
          className,
        )}
      >
        {icon}
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-activedescendant={
            open && activeIndex !== null ? `${listId}-${activeIndex}` : undefined
          }
          aria-autocomplete="list"
          aria-label={ariaLabel}
          disabled={disabled}
          placeholder={placeholder}
          // Closed, the field reads as the current value; open, it holds
          // whatever is being typed (empty = "everything", not "nothing").
          value={open ? query : selectedLabel}
          className="min-w-0 flex-1 bg-transparent text-inherit placeholder:text-muted-foreground focus:outline-none disabled:cursor-not-allowed"
          {...getReferenceProps({
            onFocus: () => setOpen(true),
            onClick: () => setOpen(true),
            onChange: (e) => {
              setQuery((e.target as HTMLInputElement).value);
              setOpen(true);
              setActiveIndex(0);
            },
            onKeyDown: (e) => {
              if (e.key === "Enter") {
                const pick = activeIndex !== null ? filtered[activeIndex] : undefined;
                if (open && pick && !pick.disabled) {
                  e.preventDefault();
                  choose(pick.value);
                }
              } else if (e.key === "Escape") {
                e.preventDefault();
                close();
                inputRef.current?.blur();
              }
            },
            onBlur: () => close(),
          })}
        />
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
          aria-hidden
        />
      </div>
      {open && (
        <FloatingPortal>
          <ul
            ref={refs.setFloating}
            id={listId}
            style={floatingStyles}
            className={`${panelClass} max-w-[18rem]`}
            {...getFloatingProps()}
          >
            {filtered.length === 0 ? (
              <li className="px-3 py-2 text-sm text-muted-foreground">{emptyLabel}</li>
            ) : (
              filtered.map((o, i) => {
                const isSelected = o.value === value;
                const isActive = i === activeIndex;
                return (
                  <li key={o.value} role="none">
                    <button
                      type="button"
                      role="option"
                      id={`${listId}-${i}`}
                      aria-selected={isSelected}
                      disabled={o.disabled}
                      tabIndex={-1}
                      ref={(node) => {
                        listRef.current[i] = node;
                      }}
                      className={cn(
                        "flex w-full items-start gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors disabled:opacity-50",
                        isActive ? "bg-os-container" : "hover:bg-os-container",
                      )}
                      {...getItemProps({
                        // The input's blur would otherwise close the panel
                        // before the click could land on the row.
                        onMouseDown: (e) => e.preventDefault(),
                        onClick: () => {
                          if (!o.disabled) choose(o.value);
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
                          <span className="text-xs text-muted-foreground">{o.description}</span>
                        )}
                      </span>
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        </FloatingPortal>
      )}
    </>
  );
}
