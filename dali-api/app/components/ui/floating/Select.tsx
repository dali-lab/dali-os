import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
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
import { Check, ChevronDown } from "lucide-react";
import { usePanelClass, useSelectTriggerClass } from "./os-styles";
import { useFeatureFlag } from "~/components/FeatureFlags";

// The app's single-select value picker, built on @floating-ui/react. Replaces
// native <select> (which can't be styled/portaled) and the old hand-rolled
// SelectMenu. Real keyboard support (arrows, Home/End, type-ahead), focus moves
// into the list on open and returns to the trigger on close, and the panel
// repositions on scroll instead of vanishing.
//
// Two modes — a drop-in for the element it replaces:
//   • Controlled / filter: pass `value` + `onChange` (onChange gets the VALUE).
//   • Form field: pass `name` (+ optional `defaultValue`). A visually-hidden
//     native <select name> carries the value for request.formData() AND native
//     `required` validation. Its DOM value is written imperatively the instant a
//     choice is made (see `choose`), so a synchronous submit(formRef) / new
//     FormData(form) reads the fresh value — no stale-value auto-submit trap.

export type SelectOption<T extends string = string> = {
  value: T;
  label: string;
  description?: string;
  disabled?: boolean;
  icon?: ReactNode;
};

export function Select<T extends string = string>({
  value,
  defaultValue,
  name,
  options,
  onChange,
  disabled = false,
  required = false,
  ariaLabel,
  placeholder,
  align = "left",
  buttonClassName,
}: {
  /** Controlled value. Omit for uncontrolled/form usage (see `name`). */
  value?: T;
  /** Initial value when uncontrolled. */
  defaultValue?: T;
  /** When set, renders a hidden native <select name> for <Form> submission. */
  name?: string;
  options: SelectOption<T>[];
  onChange?: (value: T) => void;
  disabled?: boolean;
  required?: boolean;
  ariaLabel?: string;
  /** Shown on the trigger when nothing is selected. */
  placeholder?: string;
  align?: "left" | "right";
  buttonClassName?: string;
}) {
  const os = useFeatureFlag("os-redesign");
  const panelClass = usePanelClass();
  const triggerClass = useSelectTriggerClass();
  const isControlled = value !== undefined;
  const [internal, setInternal] = useState<T | undefined>(defaultValue);
  const selected = isControlled ? value : internal;

  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const hiddenRef = useRef<HTMLSelectElement | null>(null);

  const choose = useCallback(
    (v: T) => {
      // Write the native control's value synchronously so a same-tick FormData /
      // submit reads it (the whole reason the old mirror-<select> was a trap).
      if (hiddenRef.current) hiddenRef.current.value = v;
      if (!isControlled) setInternal(v);
      onChange?.(v);
      setOpen(false);
      setActiveIndex(null);
    },
    [isControlled, onChange],
  );

  // Keep the hidden control in sync when a controlled `value` changes externally.
  useEffect(() => {
    if (hiddenRef.current && selected !== undefined) hiddenRef.current.value = selected;
  }, [selected]);

  const selectedIndex = options.findIndex((o) => o.value === selected);

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
            // Align the panel to the control it drops out of. The 200px floor
            // exists for the compact triggers this replaced a native <select>
            // on (table cells, dense forms), where a content-width menu is
            // unreadably narrow — but a toolbar filter pill is already wider
            // than its labels, so the floor only made the panel overhang it.
            // Either way this is a minimum, not a width: a long option still
            // grows the panel, up to the max-w-[18rem] on the list.
            minWidth: `${os ? rects.reference.width : Math.max(rects.reference.width, 200)}px`,
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

  const click = useClick(context, { enabled: !disabled });
  const dismiss = useDismiss(context);
  const role = useRole(context, { role: "listbox" });
  const listNav = useListNavigation(context, {
    listRef,
    activeIndex,
    selectedIndex: selectedIndex >= 0 ? selectedIndex : null,
    onNavigate: setActiveIndex,
    disabledIndices,
    loop: true,
  });
  const typeahead = useTypeahead(context, {
    listRef: labelsRef,
    activeIndex,
    selectedIndex: selectedIndex >= 0 ? selectedIndex : null,
    onMatch: (index) => {
      if (open) setActiveIndex(index);
      else choose(options[index].value);
    },
    enabled: !disabled,
  });

  const { getReferenceProps, getFloatingProps, getItemProps } = useInteractions([
    click,
    dismiss,
    role,
    listNav,
    typeahead,
  ]);

  const current = options.find((o) => o.value === selected);

  return (
    <>
      {name && (
        // Visually hidden but a real form control: participates in submission and
        // native `required` validation. Driven imperatively via hiddenRef; the
        // button below is the accessible/interactive UI.
        <select
          ref={hiddenRef}
          name={name}
          defaultValue={selected ?? ""}
          required={required}
          disabled={disabled}
          aria-hidden="true"
          tabIndex={-1}
          className="sr-only"
          onChange={() => {}}
        >
          <option value="" />
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )}
      <button
        ref={refs.setReference}
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        // Flex layout is structural (value left, chevron right) so a caller's
        // buttonClassName — even one written for a native <select> — still lays
        // out on one compact line.
        className={`inline-flex items-center justify-between gap-1 ${
          buttonClassName ?? triggerClass
        }`}
        {...getReferenceProps()}
        aria-haspopup="listbox"
      >
        <span className={`min-w-0 truncate ${current ? "" : "text-muted-foreground"}`}>
          {current?.label ?? placeholder ?? ""}
        </span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      </button>
      {open && (
        <FloatingPortal>
          <FloatingFocusManager context={context} modal={false}>
            <ul
              ref={refs.setFloating}
              style={floatingStyles}
              className={`${panelClass} max-w-[18rem]`}
              {...getFloatingProps()}
            >
              {options.map((o, i) => {
                const isSelected = o.value === selected;
                const isActive = i === activeIndex;
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
                      className={`flex w-full items-start gap-2 text-left text-sm transition-colors disabled:opacity-50 ${
                        os ? "rounded-lg px-3 py-2" : "rounded px-2 py-1.5"
                      } ${
                        os
                          ? // The design's own row fill, not a translucent wash
                            // of it — 50% muted over the card reads as a muddy
                            // tint rather than a selected row.
                            isActive
                            ? "bg-os-container"
                            : "hover:bg-os-container"
                          : isActive
                            ? "bg-muted/60"
                            : "hover:bg-muted/50"
                      }`}
                      {...getItemProps({
                        onClick: () => {
                          if (!o.disabled) choose(o.value);
                        },
                      })}
                    >
                      <Check
                        className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${
                          isSelected
                            ? os
                              ? "text-os-accent"
                              : "text-accent-coral"
                            : "opacity-0"
                        }`}
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
              })}
            </ul>
          </FloatingFocusManager>
        </FloatingPortal>
      )}
    </>
  );
}
